import { getSpec } from '../platforms/specs';
import type { Platform, PostType } from '../platforms/types';
import { platformTextLength } from '../platforms/validate';

// Tracked links: at publish time every outbound URL in a post becomes a short SocialOS link
// ({APP_URL}/l/{code}) that counts the click and redirects to the destination with UTMs added.

/** Platforms where links in the post text are clickable. On Instagram and TikTok captions they aren't. */
export const TRACKABLE_PLATFORMS: Platform[] = ['facebook', 'linkedin', 'x', 'threads', 'youtube'];

const URL_RE = /https?:\/\/[^\s<>"]+/g;
// Punctuation that usually ends a sentence rather than the URL.
const TRAILING = /[.,;:!?)\]}'"»”’]+$/;

/** URLs in a text, without trailing sentence punctuation, in order of appearance (duplicates removed). */
export function findUrls(text: string): string[] {
  const found = (text.match(URL_RE) ?? []).map((u) => u.replace(TRAILING, '')).filter((u) => isHttpUrl(u));
  return [...new Set(found)];
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  content: string;
}

export function utmFor(opts: { platform: Platform; campaign: string; content: string }): Utm {
  return { source: opts.platform, medium: 'social', campaign: opts.campaign, content: opts.content };
}

/** Adds UTM parameters, keeping any the author already set. */
export function withUtms(url: string, utm: Utm): string {
  try {
    const u = new URL(url);
    const set = (k: string, v: string) => {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    };
    set('utm_source', utm.source);
    set('utm_medium', utm.medium);
    set('utm_campaign', utm.campaign);
    set('utm_content', utm.content);
    return u.toString();
  } catch {
    return url;
  }
}

export function campaignSlug(value: string | null | undefined): string {
  const slug = (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'social';
}

/**
 * Replaces URLs in a text with their tracked versions. If that would push the text over the platform's
 * limit (tracked links can be longer than the original), the text is left unchanged.
 */
export function rewriteLinks(text: string, links: Map<string, string>, platform: Platform, postType: PostType, limit?: number): string {
  if (!links.size) return text;
  // Longest first so a URL that is a prefix of another is not replaced inside it.
  const originals = [...links.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const original of originals) out = out.split(original).join(links.get(original)!);
  const spec = getSpec(platform);
  const max = limit ?? spec.postTypes[postType]?.captionMaxLength ?? spec.captionMaxLength;
  return platformTextLength(out, spec.urlWeight) <= max ? out : text;
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random short code, e.g. "k3Zq9Tb" (62^7 ≈ 3.5 trillion). */
export function newLinkCode(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let code = '';
  for (let i = 0; code.length < length && i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b < 248) code += ALPHABET[b % 62]; // 248 = 62*4: avoids modulo bias
  }
  return code.length === length ? code : newLinkCode(length);
}

export function isValidLinkCode(code: string): boolean {
  return /^[0-9A-Za-z]{5,12}$/.test(code);
}

const BOT_RE =
  /bot|crawler|spider|crawl|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|preview|linkedinbot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|headless|curl|wget|python-requests|go-http-client|axios|node-fetch/i;

/** Link-preview fetchers and scripts: redirected, but not counted as clicks. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

/** Conversion event names: lowercase words, e.g. "signup", "trial_started", "purchase". */
export function isValidEventName(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,39}$/.test(name);
}
