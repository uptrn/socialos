import 'server-only';
import { campaignSlug, findUrls, newLinkCode, rewriteLinks, TRACKABLE_PLATFORMS, utmFor, withUtms, type Platform, type PostType } from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Base for short links: a dedicated short domain if configured, else the app itself. */
export function linkBase(): string {
  return (process.env.SHORT_LINK_BASE_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function shortLink(code: string): string {
  return `${linkBase()}/l/${code}`;
}

interface TrackInput {
  jobId: string;
  orgId: string;
  brandId: string;
  postId: string;
  postTitle: string | null;
  platform: Platform;
  postType: PostType;
  caption: string;
  threadParts: string[];
  options: Record<string, unknown>;
}

/**
 * Replaces outbound links in a post with tracked short links (created once per job and destination, so
 * retries reuse them). Leaves the post unchanged where links aren't clickable, tracking is off for the
 * brand, or a tracked link would push the text over the platform limit.
 */
export async function trackPostLinks(db: SupabaseClient, input: TrackInput): Promise<Pick<TrackInput, 'caption' | 'threadParts' | 'options'>> {
  const unchanged = { caption: input.caption, threadParts: input.threadParts, options: input.options };
  if (!TRACKABLE_PLATFORMS.includes(input.platform)) return unchanged;
  const { data: brand } = await db.from('brands').select('link_tracking').eq('id', input.brandId).single();
  if (!brand?.link_tracking) return unchanged;

  const optionLink = typeof input.options.link === 'string' ? input.options.link : null;
  const base = linkBase();
  const destinations = findUrls([input.caption, ...input.threadParts, optionLink ?? ''].join('\n')).filter((u) => !u.startsWith(`${base}/l/`));
  if (!destinations.length) return unchanged;

  const utm = { platform: input.platform, campaign: campaignSlug(input.postTitle), content: `${input.platform}-${input.jobId.slice(0, 8)}` };
  const { data: existing } = await db.from('tracked_links').select('destination, code').eq('job_id', input.jobId);
  const codes = new Map((existing ?? []).map((l) => [l.destination, l.code as string]));

  for (const destination of destinations) {
    if (codes.has(destination)) continue;
    // A new random code; retry on the (very unlikely) collision.
    for (let attempt = 0; attempt < 3 && !codes.has(destination); attempt++) {
      const code = newLinkCode();
      const { error } = await db.from('tracked_links').insert({
        org_id: input.orgId,
        brand_id: input.brandId,
        job_id: input.jobId,
        post_id: input.postId,
        platform: input.platform,
        code,
        destination,
        target_url: withUtms(destination, utmFor(utm)),
      });
      if (!error) codes.set(destination, code);
      else if (error.code === '23505') {
        // Another run created it first (job+destination), or the code collided: look again.
        const { data: row } = await db.from('tracked_links').select('code').eq('job_id', input.jobId).eq('destination', destination).maybeSingle();
        if (row) codes.set(destination, row.code);
      } else throw new Error(`tracked link: ${error.message}`);
    }
  }

  const map = new Map([...codes].filter(([d]) => destinations.includes(d)).map(([d, code]) => [d, shortLink(code)]));
  const spec = { platform: input.platform, postType: input.postType };
  return {
    caption: rewriteLinks(input.caption, map, spec.platform, spec.postType),
    // Thread posts after the first are limited like normal posts on that platform.
    threadParts: input.threadParts.map((part) => rewriteLinks(part, map, spec.platform, 'text')),
    options: optionLink && map.has(optionLink) ? { ...input.options, link: map.get(optionLink) } : input.options,
  };
}
