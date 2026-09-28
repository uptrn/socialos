import { z } from 'zod';
import { engagementRate, engagements, type PostMetrics } from '../analytics/metrics';
import type { Platform, PostType } from '../platforms/types';
import { brandContext, type BrandProfile } from './brand';

// Insights: explains what worked in a period's published posts and suggests what to do next.
// The model sees only the numbers we give it and must cite posts by their number.

export interface InsightPost extends PostMetrics {
  platform: Platform;
  postType: PostType;
  /** Brand-local weekday and hour, e.g. "Tue 09:00". */
  localTime: string;
  caption: string;
  /** From SocialOS tracked links, when link tracking is on. */
  linkClicks?: number;
  conversions?: number;
}

/** Posts needed before asking for insights; fewer can't show patterns. */
export const MIN_POSTS_FOR_INSIGHTS = 5;

export const insightsOutputSchema = z.object({
  summary: z.string().describe('Two or three sentences on how the period went, with the key numbers'),
  insights: z
    .array(
      z.object({
        title: z.string().describe('The finding in a few words'),
        detail: z.string().describe('What the data shows and why it likely happened'),
        evidence: z.array(z.number().int()).describe('Numbers of the posts that support this finding'),
        confidence: z.enum(['high', 'medium', 'low']).describe('low when based on only a few posts'),
      }),
    )
    .max(5),
  nextSteps: z.array(z.string()).max(4).describe('Concrete things to try in the next posts'),
});
export type InsightsOutput = z.infer<typeof insightsOutputSchema>;

const INSTRUCTIONS = `You analyze one brand's social media results for its marketing team. You get a numbered list of
posts published in a period, each with platform, format, local posting time, caption start and metrics.

Rules:
- Use only the data given. Don't invent benchmarks, industry averages or numbers.
- Compare posts within the same platform where possible; platforms count views differently.
- Engagement rate = (likes + comments + shares + saves) / views. Recent posts have had less time to collect views.
- When tracked link clicks and website conversions are given, they matter most: they show business results.
- A pattern seen in one or two posts is a hypothesis: say so and set confidence to low.
- Cite supporting posts by their number in "evidence".
- Next steps must be specific and doable (topic, format, hook, timing, call to action), consistent with the brand below.
- Plain language, no jargon, no hype.`;

export function insightsSystemPrompt(profile: BrandProfile): string {
  return `${INSTRUCTIONS}\n\n${brandContext(profile)}`;
}

const n = (v: number | null) => (v === null ? '-' : String(v));

export function insightsUserPrompt(periodLabel: string, posts: InsightPost[]): string {
  const lines = posts.map((p, i) => {
    const rate = engagementRate(p);
    return [
      `#${i + 1} ${p.platform} ${p.postType} | ${p.localTime}`,
      `views ${n(p.views)}, reach ${n(p.reach)}, likes ${n(p.likes)}, comments ${n(p.comments)}, shares ${n(p.shares)}, saves ${n(p.saves)}, clicks ${n(p.clicks)}, engagements ${engagements(p)}, rate ${rate === null ? '-' : `${(rate * 100).toFixed(1)}%`}` +
        (p.linkClicks !== undefined ? `, tracked link clicks ${p.linkClicks}, website conversions ${p.conversions ?? 0}` : ''),
      `caption: "${p.caption.replace(/\s+/g, ' ').slice(0, 220)}"`,
    ].join('\n');
  });
  return `Period: ${periodLabel}\nPosts: ${posts.length}\n\n${lines.join('\n\n')}`;
}

/** Drops evidence numbers that don't match a post (the model sometimes miscounts). */
export function cleanInsights(output: InsightsOutput, postCount: number): InsightsOutput {
  return {
    ...output,
    insights: output.insights.map((i) => ({ ...i, evidence: [...new Set(i.evidence)].filter((e) => e >= 1 && e <= postCount) })),
  };
}
