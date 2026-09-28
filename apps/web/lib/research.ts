import 'server-only';
import {
  finalizeResearch,
  researchOutputSchema,
  researchSystemPrompt,
  researchUserPrompt,
  STRUCTURE_INSTRUCTIONS,
  structureUserPrompt,
} from '@socialos/core';
import { runAgent, runWebResearch } from './ai/gateway';
import { loadBrandProfileRow, toBrandProfile } from './brand-profile';
import { createAdminClient } from './supabase/server';

/** Runs the Research agent for one brand and stores the opportunities it finds. Returns how many. */
export async function runBrandResearch(opts: { orgId: string; brandId: string; brandName: string; userId: string | null }): Promise<number> {
  const db = createAdminClient();
  const row = await loadBrandProfileRow(opts.brandId, db);
  const profile = toBrandProfile(opts.brandName, row);
  const settings = { keywords: row.research_keywords, competitors: row.competitors };

  const findings = await runWebResearch({
    orgId: opts.orgId,
    brandId: opts.brandId,
    userId: opts.userId,
    system: researchSystemPrompt(profile),
    user: researchUserPrompt(settings, new Date()),
    logInput: { keywords: settings.keywords, competitors: settings.competitors, scheduled: !opts.userId },
  });

  const structured = await runAgent({
    agent: 'research-structure',
    orgId: opts.orgId,
    brandId: opts.brandId,
    userId: opts.userId,
    system: STRUCTURE_INSTRUCTIONS,
    user: structureUserPrompt(findings.text, findings.sources),
    schema: researchOutputSchema,
    effort: 'low',
    logInput: { sources: findings.sources.length },
  });

  const items = finalizeResearch(structured, findings.sources);
  if (!items.length) return 0;

  const { error } = await db.from('research_items').insert(
    items.map((i) => ({
      org_id: opts.orgId,
      brand_id: opts.brandId,
      topic: i.topic,
      summary: i.summary,
      why_relevant: i.whyRelevant,
      angle: i.angle,
      platforms: i.platforms,
      format: i.format,
      priority: i.priority,
      risk: i.risk,
      kind: i.kind,
      sources: i.sources,
    })),
  );
  if (error) throw new Error(`Could not save research: ${error.message}`);
  return items.length;
}
