'use server';

import {
  cleanInsights,
  insightsOutputSchema,
  insightsSystemPrompt,
  insightsUserPrompt,
  MIN_POSTS_FOR_INSIGHTS,
  type InsightPost,
  type InsightsOutput,
  type Platform,
} from '@socialos/core';
import { z } from 'zod';
import { AiError, runAgent } from '@/lib/ai/gateway';
import { loadBrandMetrics, loadLinkStats, RANGES } from '@/lib/analytics/data';
import { BillingError, requireFeature } from '@/lib/billing/access';
import { loadBrandProfileRow, toBrandProfile } from '@/lib/brand-profile';
import { requireBrandEditor } from '@/lib/workspace';

export interface InsightsResult {
  ok: boolean;
  error?: string;
  output?: InsightsOutput;
  /** Post number (1-based, as cited in evidence) -> what to show for it. */
  posts?: { platform: Platform; caption: string; url: string | null }[];
}

/** Most posts sent to the model; the most engaging and least engaging are kept. */
const MAX_POSTS = 60;

export async function explainResults(input: { brandId: string; range: string }): Promise<InsightsResult> {
  const parsed = z.object({ brandId: z.string().uuid(), range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };
  const { brandId, range } = parsed.data;
  const ws = await requireBrandEditor(brandId);

  try {
    await requireFeature(ws.org.id, 'content_ai');
    const now = new Date();
    const from = new Date(now.getTime() - Number(range) * 86_400_000);
    const links = await loadLinkStats(brandId, from);
    const rows = (await loadBrandMetrics(brandId, from, now, links)).filter((r) => r.collectedAt);
    if (rows.length < MIN_POSTS_FOR_INSIGHTS) {
      return { ok: false, error: `Insights need at least ${MIN_POSTS_FOR_INSIGHTS} posts with numbers in this period (you have ${rows.length}).` };
    }

    const sorted = [...rows].sort((a, b) => b.engagements - a.engagements);
    const picked = sorted.length > MAX_POSTS ? [...sorted.slice(0, MAX_POSTS / 2), ...sorted.slice(-MAX_POSTS / 2)] : sorted;
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: ws.brand.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const posts: InsightPost[] = picked.map((r) => ({
      ...r,
      localTime: localTime.format(r.publishedAt),
      caption: r.caption,
      // Only when this brand uses tracked links, so "0 clicks" isn't read as a result.
      linkClicks: links.length ? r.linkClicks : undefined,
      conversions: links.length ? r.conversions : undefined,
    }));

    const profile = toBrandProfile(ws.brand.name, await loadBrandProfileRow(brandId));
    const output = await runAgent({
      agent: 'insights',
      orgId: ws.org.id,
      brandId,
      userId: ws.userId,
      system: insightsSystemPrompt(profile),
      user: insightsUserPrompt(`${RANGES[range]} (up to ${now.toISOString().slice(0, 10)})`, posts),
      schema: insightsOutputSchema,
      effort: 'medium',
      logInput: { range, posts: posts.length },
    });
    return {
      ok: true,
      output: cleanInsights(output, posts.length),
      posts: picked.map((r) => ({ platform: r.platform, caption: r.caption.slice(0, 140), url: r.url })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof AiError || e instanceof BillingError ? e.message : 'Could not analyze the results.' };
  }
}
