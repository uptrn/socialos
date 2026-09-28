import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { getAccess } from '../billing/access';
import { createAdminClient } from '../supabase/server';

// Single entry point for all model calls: budget check, call, cost accounting, run log.

export class AiError extends Error {
  constructor(message: string, readonly kind: 'not_configured' | 'over_budget' | 'refused' | 'failed') {
    super(message);
  }
}

/** Monthly AI spend allowed by the organization's plan (USD). */
export async function monthlyBudget(orgId: string): Promise<number> {
  return (await getAccess(orgId)).limits.aiBudgetUsd;
}

const DEFAULT_MODEL = 'claude-opus-5';

/** USD per million tokens. Used for the run log and budget; update when prices change. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Web search is billed per search on top of tokens. */
const WEB_SEARCH_USD = 10 / 1000;

function costUsd(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const price = Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1] ?? PRICES[DEFAULT_MODEL]!;
  const perToken = (usd: number) => usd / 1_000_000;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    usage.input_tokens * perToken(price.input) +
    cacheRead * perToken(price.input) * 0.1 +
    cacheWrite * perToken(price.input) * 1.25 +
    usage.output_tokens * perToken(price.output)
  );
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError('AI is not set up yet (missing ANTHROPIC_API_KEY).', 'not_configured');
  client ??= new Anthropic();
  return client;
}

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface AgentCall<S extends z.ZodType> {
  agent: string;
  orgId: string;
  brandId: string;
  /** Null for scheduled runs. */
  userId: string | null;
  /** Stable per brand, so it is cached between calls. */
  system: string;
  user: string;
  schema: S;
  effort?: 'low' | 'medium' | 'high';
  /** Stored in the run log (keep it small and free of secrets). */
  logInput: Record<string, unknown>;
}

export async function runAgent<S extends z.ZodType>(call: AgentCall<S>): Promise<z.infer<S>> {
  const anthropic = getClient();
  const db = createAdminClient();
  const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
  const budget = await monthlyBudget(call.orgId);
  const started = Date.now();

  const log = (row: Record<string, unknown>) =>
    db.from('agent_runs').insert({
      org_id: call.orgId,
      brand_id: call.brandId,
      agent: call.agent,
      input: call.logInput,
      created_by: call.userId,
      duration_ms: Date.now() - started,
      ...row,
    });

  const { data: spent } = await db.rpc('org_ai_spend_this_month', { p_org: call.orgId });
  if (Number(spent ?? 0) >= budget) {
    await log({ model, status: 'over_budget', error: `Monthly AI budget of $${budget} reached` });
    throw new AiError(`This month's AI budget ($${budget}) has been used. It resets on the 1st.`, 'over_budget');
  }

  try {
    const response = await anthropic.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      // If the primary model declines, the API retries on a fallback model in the same call.
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: call.effort ?? 'medium', format: betaZodOutputFormat(call.schema) },
      system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: call.user }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cost_usd: costUsd(response.model, response.usage),
    };

    if (response.stop_reason === 'refusal') {
      await log({ model: response.model, status: 'refused', error: response.stop_details?.explanation ?? 'refused', ...usage });
      throw new AiError('The AI declined this request. Try rephrasing the brief.', 'refused');
    }
    if (!response.parsed_output) {
      await log({ model: response.model, status: 'failed', error: `No structured output (stop: ${response.stop_reason})`, ...usage });
      throw new AiError('The AI returned an incomplete answer. Please try again.', 'failed');
    }

    await log({ model: response.model, status: 'succeeded', output: response.parsed_output, ...usage });
    return response.parsed_output as z.infer<S>;
  } catch (e) {
    if (e instanceof AiError) throw e;
    const message =
      e instanceof Anthropic.RateLimitError
        ? 'The AI service is busy. Try again in a minute.'
        : e instanceof Anthropic.AuthenticationError
          ? 'The AI API key is invalid.'
          : e instanceof Anthropic.APIError
            ? `AI request failed (${e.status}).`
            : 'AI request failed.';
    await log({ model, status: 'failed', error: (e as Error).message.slice(0, 1000) });
    throw new AiError(message, 'failed');
  }
}

export interface WebSource {
  url: string;
  title: string;
  published?: string;
}

export interface ResearchCall {
  orgId: string;
  brandId: string;
  userId: string | null;
  system: string;
  user: string;
  logInput: Record<string, unknown>;
  maxSearches?: number;
}

/**
 * A model call with server-side web search. Returns the model's written findings and every
 * source the searches returned (the only URLs we will later accept as citations).
 */
export async function runWebResearch(call: ResearchCall): Promise<{ text: string; sources: WebSource[] }> {
  const anthropic = getClient();
  const db = createAdminClient();
  const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
  const budget = await monthlyBudget(call.orgId);
  const started = Date.now();
  const log = (row: Record<string, unknown>) =>
    db.from('agent_runs').insert({
      org_id: call.orgId,
      brand_id: call.brandId,
      agent: 'research',
      input: call.logInput,
      created_by: call.userId,
      duration_ms: Date.now() - started,
      ...row,
    });

  const { data: spent } = await db.rpc('org_ai_spend_this_month', { p_org: call.orgId });
  if (Number(spent ?? 0) >= budget) {
    await log({ model, status: 'over_budget', error: `Monthly AI budget of $${budget} reached` });
    throw new AiError(`This month's AI budget ($${budget}) has been used. It resets on the 1st.`, 'over_budget');
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: call.user }];
  const sources = new Map<string, WebSource>();
  const texts: string[] = [];
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
  let servedBy = model;

  try {
    // The server runs the search loop; if it pauses (pause_turn) we send the turn back to resume.
    for (let round = 0; round < 4; round++) {
      const response = await anthropic.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: call.maxSearches ?? 12 }],
        messages,
      });
      servedBy = response.model;
      const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
      totals.input_tokens += response.usage.input_tokens;
      totals.output_tokens += response.usage.output_tokens;
      totals.cache_read_tokens += response.usage.cache_read_input_tokens ?? 0;
      totals.cost_usd += costUsd(response.model, response.usage) + searches * WEB_SEARCH_USD;

      for (const block of response.content) {
        if (block.type === 'text') texts.push(block.text);
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) sources.set(r.url, { url: r.url, title: r.title, published: r.page_age ?? undefined });
        }
      }

      if (response.stop_reason === 'refusal') {
        await log({ model: servedBy, status: 'refused', error: response.stop_details?.explanation ?? 'refused', ...totals });
        throw new AiError('The AI declined this research request.', 'refused');
      }
      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }

    const text = texts.join('\n').trim();
    if (!text) {
      await log({ model: servedBy, status: 'failed', error: 'No findings returned', ...totals });
      throw new AiError('Research returned no findings. Try again or add keywords in the Brand Brain.', 'failed');
    }
    await log({ model: servedBy, status: 'succeeded', output: { sources: sources.size, characters: text.length }, ...totals });
    return { text, sources: [...sources.values()] };
  } catch (e) {
    if (e instanceof AiError) throw e;
    await log({ model: servedBy, status: 'failed', error: (e as Error).message.slice(0, 1000), ...totals });
    throw new AiError(e instanceof Anthropic.RateLimitError ? 'The AI service is busy. Try again in a minute.' : 'Research failed.', 'failed');
  }
}

export interface RunLog {
  orgId: string;
  brandId: string | null;
  userId: string | null;
  agent: string;
  model: string;
  status: 'succeeded' | 'failed' | 'refused' | 'over_budget';
  input: Record<string, unknown>;
  output?: unknown;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}

/** Logs a non-Claude AI call (e.g. image generation) in the same run log and budget. */
export async function logAgentRun(run: RunLog) {
  await createAdminClient().from('agent_runs').insert({
    org_id: run.orgId,
    brand_id: run.brandId,
    agent: run.agent,
    model: run.model,
    status: run.status,
    input: run.input,
    output: run.output ?? null,
    cost_usd: run.costUsd ?? 0,
    duration_ms: run.durationMs ?? null,
    error: run.error?.slice(0, 1000) ?? null,
    created_by: run.userId,
  });
}

/** Throws (and logs) if the organization has used this month's AI budget. */
export async function assertAiBudget(run: Omit<RunLog, 'status' | 'model'> & { model: string }) {
  const budget = await monthlyBudget(run.orgId);
  const { data: spent } = await createAdminClient().rpc('org_ai_spend_this_month', { p_org: run.orgId });
  if (Number(spent ?? 0) >= budget) {
    await logAgentRun({ ...run, status: 'over_budget', error: `Monthly AI budget of $${budget} reached` });
    throw new AiError(`This month's AI budget ($${budget}) has been used. It resets on the 1st.`, 'over_budget');
  }
}
