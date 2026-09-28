'use server';

import {
  CONTENT_GOALS,
  POST_TYPES,
  PLATFORMS,
  brandGaps,
  checkBrandRules,
  contentOutputSchema,
  contentSystemPrompt,
  contentUserPrompt,
  finalizeDrafts,
  getSpec,
  qaOutputSchema,
  qaSystemPrompt,
  qaUserPrompt,
  type FinalDraft,
  type QaFinding,
} from '@socialos/core';
import { z } from 'zod';
import { AiError, runAgent } from '@/lib/ai/gateway';
import { BillingError, requireFeature } from '@/lib/billing/access';
import { loadBrandProfileRow, toBrandProfile } from '@/lib/brand-profile';
import { requireBrandEditor } from '@/lib/workspace';

const generateSchema = z.object({
  brandId: z.string().uuid(),
  brief: z.string().trim().min(10, 'Describe the post in a sentence or two.').max(4000),
  goal: z.enum(CONTENT_GOALS),
  link: z.union([z.literal(''), z.string().url('Enter a full link, e.g. https://…')]).optional(),
  targets: z.array(z.object({ key: z.string().uuid(), platform: z.enum(PLATFORMS), postType: z.enum(POST_TYPES) })).min(1, 'Choose at least one account.').max(20),
});

export interface GenerateResult {
  ok: boolean;
  error?: string;
  drafts?: (FinalDraft & { findings: QaFinding[] })[];
  assumptions?: string[];
  brandGaps?: string[];
}

export async function generateDrafts(input: z.input<typeof generateSchema>): Promise<GenerateResult> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const req = parsed.data;
  const ws = await requireBrandEditor(req.brandId);
  const profile = toBrandProfile(ws.brand.name, await loadBrandProfileRow(req.brandId));

  try {
    await requireFeature(ws.org.id, 'content_ai');
    const request = { brief: req.brief, goal: req.goal, link: req.link || undefined, targets: req.targets };
    const output = await runAgent({
      agent: 'content',
      orgId: ws.org.id,
      brandId: req.brandId,
      userId: ws.userId,
      system: contentSystemPrompt(profile),
      user: contentUserPrompt(request),
      schema: contentOutputSchema,
      effort: 'medium',
      logInput: { brief: req.brief, goal: req.goal, platforms: req.targets.map((t) => `${t.platform}:${t.postType}`) },
    });
    const drafts = finalizeDrafts(request, output).map((d) => ({
      ...d,
      findings: checkBrandRules([d.caption, ...d.threadParts].join('\n'), profile),
    }));
    return { ok: true, drafts, assumptions: output.assumptions, brandGaps: brandGaps(profile) };
  } catch (e) {
    return { ok: false, error: e instanceof AiError || e instanceof BillingError ? e.message : 'Could not generate drafts.' };
  }
}

const reviewSchema = z.object({
  brandId: z.string().uuid(),
  platform: z.enum(PLATFORMS),
  text: z.string().trim().min(1, 'Nothing to check yet.').max(70000),
});

export async function reviewDraft(input: z.input<typeof reviewSchema>): Promise<{ ok: boolean; error?: string; findings?: QaFinding[] }> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const { brandId, platform, text } = parsed.data;
  const ws = await requireBrandEditor(brandId);
  const profile = toBrandProfile(ws.brand.name, await loadBrandProfileRow(brandId));

  const ruleFindings = checkBrandRules(text, profile);
  try {
    await requireFeature(ws.org.id, 'qa_ai');
    const output = await runAgent({
      agent: 'qa',
      orgId: ws.org.id,
      brandId,
      userId: ws.userId,
      system: qaSystemPrompt(profile),
      user: qaUserPrompt(getSpec(platform).label, text),
      schema: qaOutputSchema,
      effort: 'medium',
      logInput: { platform, length: text.length },
    });
    const modelFindings: QaFinding[] = output.findings.map((f) => ({ ...f, suggestion: f.suggestion || undefined }));
    // Rule findings first; skip model findings that repeat a rule finding.
    const seen = new Set(ruleFindings.map((f) => f.quote.toLowerCase()));
    return { ok: true, findings: [...ruleFindings, ...modelFindings.filter((f) => !seen.has(f.quote.toLowerCase()))] };
  } catch (e) {
    // The free rule checks still help when the model is unavailable.
    return { ok: ruleFindings.length > 0, findings: ruleFindings, error: e instanceof AiError || e instanceof BillingError ? e.message : 'AI check failed.' };
  }
}
