import { z } from 'zod';
import { getSpec } from '../platforms/specs';
import type { Platform, PostType } from '../platforms/types';
import { platformTextLength } from '../platforms/validate';
import { brandContext, type BrandProfile } from './brand';

// Content agent: turns a short brief into platform-native captions, grounded in the Brand Brain.

export const CONTENT_GOALS = ['awareness', 'engagement', 'traffic', 'signups', 'announcement'] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];

export interface ContentTarget {
  key: string; // caller's id for this target (social account id)
  platform: Platform;
  postType: PostType;
}

export interface ContentRequest {
  brief: string;
  goal: ContentGoal;
  link?: string;
  targets: ContentTarget[];
}

export const contentOutputSchema = z.object({
  drafts: z.array(
    z.object({
      key: z.string().describe('The target key this draft is for, copied exactly'),
      caption: z.string().describe('The full post text, without the hashtags'),
      hashtags: z.array(z.string()).describe('Hashtags without the # sign'),
      threadParts: z.array(z.string()).describe('Follow-up posts for a thread; empty unless the platform supports threads and the content needs it'),
      youtubeTitle: z.string().describe('YouTube video title; empty for other platforms'),
    }),
  ),
  assumptions: z.array(z.string()).describe('Anything you had to assume because the brief or brand facts did not say'),
});
export type ContentOutput = z.infer<typeof contentOutputSchema>;

const INSTRUCTIONS = `You write social media posts for one brand. The brand's facts and voice are below.

Write like the brand's own marketer, not like an AI: specific, concrete, no filler, no hype words
the brand wouldn't use. Each platform gets a post written for how people use that platform, not the
same text resized. Start with a line that earns attention on that platform.

Stay within the facts. Only state features, prices, numbers or results that appear in the brand facts
or the brief. If a strong post seems to need a fact you don't have, write around it and list what you
assumed. Never use anything under "Never claim" or "Words and phrases to avoid".

Use hashtags the way each platform's audience does (few or none on LinkedIn and X, more on Instagram and
TikTok), preferring the brand's default hashtags when relevant. Respect each target's character limit,
counting the hashtags you add.`;

/** Stable system prompt (instructions + Brand Brain) — identical across requests for a brand. */
export function contentSystemPrompt(profile: BrandProfile): string {
  return `${INSTRUCTIONS}\n\n${brandContext(profile)}`;
}

export function contentUserPrompt(req: ContentRequest): string {
  const targets = req.targets
    .map((t) => {
      const spec = getSpec(t.platform);
      const limit = spec.postTypes[t.postType]?.captionMaxLength ?? spec.captionMaxLength;
      const extras = [
        spec.supportsThread ? 'threads allowed' : '',
        spec.maxHashtags !== undefined ? `max ${spec.maxHashtags} hashtags` : '',
        spec.postTypes[t.postType]?.captionSupported === false ? 'caption is not shown — keep it empty' : '',
      ].filter(Boolean);
      return `- key "${t.key}": ${spec.label} ${t.postType}, up to ${limit} characters${extras.length ? ` (${extras.join(', ')})` : ''}`;
    })
    .join('\n');

  return [
    `Brief: ${req.brief.trim()}`,
    `Goal: ${req.goal}`,
    req.link ? `Link to include where it fits the platform: ${req.link}` : '',
    `Write one draft for each target:\n${targets}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Caption with hashtags appended, as it will be posted. */
export function assembleCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags
    .map((h) => h.trim().replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h) => `#${h}`);
  const unique = [...new Set(tags)].filter((tag) => !caption.includes(tag));
  return unique.length ? `${caption.trim()}\n\n${unique.join(' ')}` : caption.trim();
}

export interface FinalDraft {
  key: string;
  caption: string;
  threadParts: string[];
  youtubeTitle?: string;
  /** Post-processing notes, e.g. hashtags dropped to fit the limit. */
  notes: string[];
}

/**
 * Makes model output safe to drop into the composer: hashtags attached, trimmed to the
 * platform's hashtag and length limits, drafts for unknown targets ignored.
 */
export function finalizeDrafts(req: ContentRequest, output: ContentOutput): FinalDraft[] {
  const results: FinalDraft[] = [];
  for (const target of req.targets) {
    const draft = output.drafts.find((d) => d.key === target.key);
    if (!draft) continue;
    const spec = getSpec(target.platform);
    const typeSpec = spec.postTypes[target.postType];
    const limit = typeSpec?.captionMaxLength ?? spec.captionMaxLength;
    const notes: string[] = [];

    if (typeSpec?.captionSupported === false) {
      results.push({ key: target.key, caption: '', threadParts: [], notes: ['This post type has no caption.'] });
      continue;
    }

    let hashtags = draft.hashtags;
    if (spec.maxHashtags !== undefined && hashtags.length > spec.maxHashtags) {
      hashtags = hashtags.slice(0, spec.maxHashtags);
      notes.push(`Kept the first ${spec.maxHashtags} hashtags.`);
    }
    let caption = assembleCaption(draft.caption, hashtags);
    // Drop hashtags from the end until it fits; never cut the written text itself.
    while (platformTextLength(caption, spec.urlWeight) > limit && hashtags.length) {
      hashtags = hashtags.slice(0, -1);
      caption = assembleCaption(draft.caption, hashtags);
    }
    if (platformTextLength(caption, spec.urlWeight) > limit) notes.push(`Over the ${limit}-character limit; shorten before scheduling.`);

    results.push({
      key: target.key,
      caption,
      threadParts: spec.supportsThread ? draft.threadParts.filter((p) => p.trim()) : [],
      youtubeTitle: target.platform === 'youtube' && draft.youtubeTitle ? draft.youtubeTitle.slice(0, 100) : undefined,
      notes,
    });
  }
  return results;
}
