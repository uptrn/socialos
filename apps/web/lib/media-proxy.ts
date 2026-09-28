import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, expiring links that serve a media file from this app's own domain (/m/{token}).
// Needed for platforms that only fetch media from domains you've verified with them (TikTok photos).

interface Payload {
  p: string; // storage path
  m: string; // mime type
  e: number; // expiry, unix seconds
}

function secret(): string {
  const value = process.env.MEDIA_PROXY_SECRET ?? process.env.CRON_SECRET;
  if (!value) throw new Error('MEDIA_PROXY_SECRET (or CRON_SECRET) is not set');
  return value;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Public HTTPS URL for a stored file, or undefined when the app has no public HTTPS address. */
export function mediaProxyUrl(storagePath: string, mimeType: string, ttlSec: number): string | undefined {
  const base = process.env.APP_URL;
  if (!base?.startsWith('https://')) return undefined;
  const payload = Buffer.from(JSON.stringify({ p: storagePath, m: mimeType, e: Math.floor(Date.now() / 1000) + ttlSec } satisfies Payload)).toString('base64url');
  return `${base}/m/${payload}.${sign(payload)}`;
}

export function verifyMediaToken(token: string): Payload | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Payload;
    return data.e > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}
