import { z } from 'zod';
import { PLATFORMS } from '../platforms/types';
import { brandContext, type BrandProfile } from './brand';

// Research agent, in two steps:
// 1. research: the model searches the web (server-side web search) and writes findings
// 2. structure: a second call turns the findings into content opportunities (structured output)
// Sources are only kept if they were actually returned by the searches in step 1.

export interface ResearchSettings {
  keywords: string[];
  competitors: string[];
}

export interface WebSource {
  url: string;
  title: string;
  published?: string;
}

const RESEARCH_INSTRUCTIONS = `You are the research assistant for one brand's social media. Use web search to find what is
worth posting about now. The brand's facts are below.

Look for, within roughly the last 30 days unless something older is clearly still relevant:
- news and developments in the brand's industry that its audience would care about
- questions and problems the audience is actively discussing
- what the listed competitors are announcing or saying
- dates, events or seasonal moments coming up in the next few weeks

For each finding, say what happened, when, why it matters to this brand's audience, and one concrete
post angle the brand could take that fits its voice and facts. Mention the source for every factual
statement. Prefer primary and reputable sources; say so when something is disputed or unconfirmed.
Skip anything the brand should stay out of (politics, tragedies, competitor attacks) and anything you
can't tie back to the brand's audience. Aim for 6-10 strong findings rather than many weak ones.`;

export function researchSystemPrompt(profile: BrandProfile): string {
  return `${RESEARCH_INSTRUCTIONS}\n\n${brandContext(profile)}`;
}

export function researchUserPrompt(settings: ResearchSettings, today: Date): string {
  return [
    `Today's date: ${today.toISOString().slice(0, 10)}.`,
    settings.keywords.length ? `Topics and keywords to cover: ${settings.keywords.join(', ')}.` : '',
    settings.competitors.length ? `Competitors to watch: ${settings.competitors.join(', ')}.` : '',
    'Research now and write up your findings.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const researchOutputSchema = z.object({
  items: z.array(
    z.object({
      topic: z.string().describe('Short headline for the opportunity'),
      summary: z.string().describe('What happened / what people are discussing, 1-3 sentences'),
      whyRelevant: z.string().describe("Why this brand's audience cares"),
      angle: z.string().describe('The post idea: what the brand should say about it'),
      kind: z.enum(['trend', 'news', 'competitor', 'question', 'evergreen']),
      platforms: z.array(z.enum(PLATFORMS)).describe('Best platforms for this idea'),
      format: z.string().describe('Suggested format, e.g. carousel, short video, text post, thread'),
      priority: z.number().int().describe('1-10: timeliness x relevance x fit with the brand'),
      risk: z.enum(['low', 'medium', 'high']).describe('Reputational or factual risk of posting about it'),
      sourceUrls: z.array(z.string()).describe('URLs of the sources for this item, copied exactly from the source list'),
    }),
  ),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export const STRUCTURE_INSTRUCTIONS = `Turn research notes into a list of social media content opportunities for the brand.
Use only what the notes say. Every item must cite at least one URL from the numbered source list,
copied exactly. Drop findings that have no source. Rank priority honestly: most items are not a 10.`;

export function structureUserPrompt(notes: string, sources: WebSource[]): string {
  const list = sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}${s.published ? ` (${s.published})` : ''}`).join('\n');
  return `Research notes:\n"""\n${notes}\n"""\n\nSources found:\n${list || '(none)'}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    // Drop tracking parameters so equivalent links match.
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key);
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

export interface ResearchItem {
  topic: string;
  summary: string;
  whyRelevant: string;
  angle: string;
  kind: ResearchOutput['items'][number]['kind'];
  platforms: string[];
  format: string;
  priority: number;
  risk: 'low' | 'medium' | 'high';
  sources: WebSource[];
}

/**
 * Keeps only sources that the web search really returned (no invented links), drops items
 * left without a source, clamps priority to 1-10 and de-duplicates topics.
 */
export function finalizeResearch(output: ResearchOutput, found: WebSource[]): ResearchItem[] {
  const byUrl = new Map(found.map((s) => [normalizeUrl(s.url), s]));
  const seenTopics = new Set<string>();
  const items: ResearchItem[] = [];

  for (const item of output.items) {
    const sources = [...new Set(item.sourceUrls.map(normalizeUrl))].map((u) => byUrl.get(u)).filter((s): s is WebSource => !!s);
    const topicKey = item.topic.toLowerCase().trim();
    if (!sources.length || seenTopics.has(topicKey)) continue;
    seenTopics.add(topicKey);
    items.push({
      topic: item.topic.trim(),
      summary: item.summary.trim(),
      whyRelevant: item.whyRelevant.trim(),
      angle: item.angle.trim(),
      kind: item.kind,
      platforms: [...new Set(item.platforms)],
      format: item.format.trim(),
      priority: Math.min(10, Math.max(1, Math.round(item.priority))),
      risk: item.risk,
      sources,
    });
  }
  return items.sort((a, b) => b.priority - a.priority);
}

/** A composer brief from a research item, for "Create post". */
export function researchBrief(item: Pick<ResearchItem, 'topic' | 'angle' | 'summary'>): string {
  return `${item.angle}\n\nContext: ${item.topic} — ${item.summary}`;
}
