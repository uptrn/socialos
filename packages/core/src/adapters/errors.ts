/**
 * How a publish failure should be handled.
 * - transient:       network / 5xx — retry with backoff
 * - rate_limited:    platform throttling — retry after the reset window
 * - auth_expired:    token expired or revoked — pause the account, alert admins
 * - invalid_content: platform rejected the content — send back for revision
 * - ambiguous:       request may have succeeded (e.g. timeout after sending) —
 *                    never auto-retry; a human must check, to avoid double posts
 * - permanent:       anything else we should not retry
 */
export type PublishErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'auth_expired'
  | 'invalid_content'
  | 'ambiguous'
  | 'permanent';

export class PublishError extends Error {
  readonly errorClass: PublishErrorClass;
  readonly retryAfterSec?: number;
  readonly platformCode?: string;

  constructor(
    errorClass: PublishErrorClass,
    message: string,
    opts: { retryAfterSec?: number; platformCode?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'PublishError';
    this.errorClass = errorClass;
    this.retryAfterSec = opts.retryAfterSec;
    this.platformCode = opts.platformCode;
  }
}

/** Unknown errors are treated as ambiguous: safer to ask a human than to double-post. */
export function toPublishError(error: unknown): PublishError {
  if (error instanceof PublishError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PublishError('ambiguous', message, { cause: error });
}
