import type { PublishError } from '../adapters/errors';

export const JOB_STATUSES = [
  'scheduled', // waiting for its time
  'publishing', // claimed by a worker right now
  'processing', // platform accepted it and is still processing (e.g. video)
  'retrying', // failed temporarily, will try again at next_attempt_at
  'published',
  'failed', // gave up; needs a human
  'needs_revision', // platform rejected the content
  'needs_check', // may or may not have posted; a human must check before any retry
  'missed', // system was down past the lateness window; a human decides
  'paused', // social account disconnected or expired
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface RetryPolicy {
  maxAttempts: number;
  baseDelaySec: number;
  maxDelaySec: number;
  defaultRateLimitDelaySec: number;
  /** Jobs picked up later than this after their scheduled time are not published automatically. */
  maxLatenessSec: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelaySec: 60,
  maxDelaySec: 30 * 60,
  defaultRateLimitDelaySec: 15 * 60,
  maxLatenessSec: 6 * 60 * 60,
};

export type FailureDecision =
  | { action: 'retry'; at: Date; status: 'retrying' }
  | { action: 'stop'; status: Extract<JobStatus, 'failed' | 'needs_revision' | 'needs_check'> }
  | { action: 'pause_account'; status: 'paused' };

/** Decide what happens after a failed attempt. `attempt` is 1 for the first try. */
export function decideOnFailure(
  error: PublishError,
  attempt: number,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): FailureDecision {
  switch (error.errorClass) {
    case 'auth_expired':
      return { action: 'pause_account', status: 'paused' };
    case 'invalid_content':
      return { action: 'stop', status: 'needs_revision' };
    case 'ambiguous':
      return { action: 'stop', status: 'needs_check' };
    case 'permanent':
      return { action: 'stop', status: 'failed' };
    case 'rate_limited':
    case 'transient': {
      if (attempt >= policy.maxAttempts) return { action: 'stop', status: 'failed' };
      const delaySec =
        error.errorClass === 'rate_limited'
          ? error.retryAfterSec ?? policy.defaultRateLimitDelaySec
          : backoffDelaySec(attempt, policy);
      return { action: 'retry', at: new Date(now.getTime() + delaySec * 1000), status: 'retrying' };
    }
  }
}

export function backoffDelaySec(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  return Math.min(policy.baseDelaySec * 2 ** (attempt - 1), policy.maxDelaySec);
}

export function isTooLate(scheduledAt: Date, now: Date, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return now.getTime() - scheduledAt.getTime() > policy.maxLatenessSec * 1000;
}

/** Stable key for one variant published to one account; unique in publish_jobs. */
export function idempotencyKey(variantId: string, socialAccountId: string, revision: number): string {
  return `${variantId}:${socialAccountId}:r${revision}`;
}
