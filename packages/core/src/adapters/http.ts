import { PublishError, type PublishErrorClass } from './errors';

export type FetchLike = typeof fetch;

/**
 * Which step a request belongs to decides how a network failure is classified:
 * - 'prepare' (uploads, status checks): nothing is public yet, so retrying is safe
 * - 'publish' (the call that makes the post live): a lost response might mean it
 *   was posted, so it is 'ambiguous' and never retried automatically
 */
export type RequestStage = 'prepare' | 'publish';

export interface RequestOptions extends RequestInit {
  stage: RequestStage;
  what: string;
  /** Per-request timeout; default 60s. */
  timeoutMs?: number;
}

export function classifyStatus(status: number): PublishErrorClass {
  if (status === 401) return 'auth_expired';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status >= 500) return 'transient';
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 413 || status === 422) {
    return 'invalid_content';
  }
  return 'permanent';
}

function retryAfterSec(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - Date.now()) / 1000));
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>;
    return b.error?.message ?? b.error?.error_user_msg ?? b.message ?? b.error_description ?? b.error?.toString?.() ?? fallback;
  }
  return typeof body === 'string' && body ? body.slice(0, 300) : fallback;
}

/** fetch() that turns every failure into a correctly classified PublishError. */
export async function request(fetchImpl: FetchLike, url: string, opts: RequestOptions): Promise<Response> {
  const { stage, what, timeoutMs = 60_000, ...init } = opts;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const errorClass: PublishErrorClass = stage === 'publish' ? 'ambiguous' : 'transient';
    throw new PublishError(errorClass, `${what}: network error (${(cause as Error).message})`, { cause });
  }
  if (res.ok) return res;

  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  let errorClass = classifyStatus(res.status);
  // A 5xx on the publishing call might still have created the post.
  if (stage === 'publish' && errorClass === 'transient') errorClass = 'ambiguous';
  throw new PublishError(errorClass, `${what} failed (${res.status}): ${errorMessage(body, res.statusText)}`, {
    retryAfterSec: errorClass === 'rate_limited' ? retryAfterSec(res) : undefined,
    platformCode: String(res.status),
  });
}

export async function requestJson<T>(fetchImpl: FetchLike, url: string, opts: RequestOptions): Promise<T> {
  const res = await request(fetchImpl, url, opts);
  return (await res.json()) as T;
}
