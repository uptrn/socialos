import { PublishError, toPublishError } from '../adapters/errors';
import type { AccountCredentials, AdapterRegistry, PublishRequest, PublishResult } from '../adapters/types';
import type { Platform } from '../platforms/types';
import { DEFAULT_RETRY_POLICY, decideOnFailure, isTooLate, type RetryPolicy } from './policy';

export interface ClaimedJob {
  id: string;
  platform: Platform;
  socialAccountId: string;
  scheduledAt: Date;
  /** Attempt number of this run (already incremented by the claim). */
  attempt: number;
  /** Set when resuming a job that returned "processing". */
  resumeState?: Record<string, unknown>;
}

export interface PublishContext {
  request: PublishRequest;
  account: AccountCredentials;
  accountStatus: 'active' | 'expired' | 'revoked' | 'error';
  /** Set when the organization may not publish right now (e.g. subscription inactive). */
  blockedReason?: string;
}

/** Persistence operations the runner needs. Implemented over Postgres in the web app. */
export interface JobRepository {
  /** Atomically claim due jobs (FOR UPDATE SKIP LOCKED) and mark them "publishing". */
  claimDueJobs(now: Date, limit: number): Promise<ClaimedJob[]>;
  loadContext(job: ClaimedJob): Promise<PublishContext>;
  markPublished(jobId: string, result: Extract<PublishResult, { status: 'published' }>): Promise<void>;
  markProcessing(jobId: string, checkAt: Date, resumeState: Record<string, unknown>): Promise<void>;
  markRetry(jobId: string, nextAttemptAt: Date, error: PublishError): Promise<void>;
  markStopped(jobId: string, status: 'failed' | 'needs_revision' | 'needs_check' | 'missed' | 'paused', error: PublishError | null): Promise<void>;
  pauseAccount(socialAccountId: string, reason: string): Promise<void>;
}

export interface Notifier {
  jobNeedsAttention(jobId: string, status: string, message: string): Promise<void>;
}

export interface RunnerDeps {
  repo: JobRepository;
  adapters: AdapterRegistry;
  notifier?: Notifier;
  now?: () => Date;
  policy?: RetryPolicy;
  batchSize?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface RunSummary {
  claimed: number;
  published: number;
  processing: number;
  retrying: number;
  stopped: number;
}

/** Process all jobs that are due now. Safe to run concurrently from several workers. */
export async function runDueJobs(deps: RunnerDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  const policy = deps.policy ?? DEFAULT_RETRY_POLICY;
  const log = deps.log ?? (() => {});
  const summary: RunSummary = { claimed: 0, published: 0, processing: 0, retrying: 0, stopped: 0 };

  const jobs = await deps.repo.claimDueJobs(now(), deps.batchSize ?? 20);
  summary.claimed = jobs.length;

  for (const job of jobs) {
    const outcome = await runOne(job, deps, now, policy, log);
    summary[outcome] += 1;
  }
  return summary;
}

type Outcome = 'published' | 'processing' | 'retrying' | 'stopped';

async function runOne(
  job: ClaimedJob,
  deps: RunnerDeps,
  now: () => Date,
  policy: RetryPolicy,
  log: NonNullable<RunnerDeps['log']>,
): Promise<Outcome> {
  const { repo, notifier } = deps;

  // A brand-new job picked up far too late (worker was down) is not posted automatically.
  if (!job.resumeState && job.attempt === 1 && isTooLate(job.scheduledAt, now(), policy)) {
    await repo.markStopped(job.id, 'missed', null);
    await notifier?.jobNeedsAttention(job.id, 'missed', 'Scheduled time passed while the system was unavailable.');
    return 'stopped';
  }

  const adapter = deps.adapters[job.platform];
  if (!adapter) {
    const error = new PublishError('permanent', `No adapter configured for ${job.platform}`);
    await repo.markStopped(job.id, 'failed', error);
    await notifier?.jobNeedsAttention(job.id, 'failed', error.message);
    return 'stopped';
  }

  let context: PublishContext;
  try {
    context = await repo.loadContext(job);
  } catch (e) {
    // Keep classified errors (e.g. an expired token found while loading); anything else is temporary.
    const error = e instanceof PublishError ? e : new PublishError('transient', `Could not load job: ${(e as Error).message}`, { cause: e });
    return handleFailure(job, error, deps, now, policy);
  }

  if (context.accountStatus !== 'active') {
    await repo.markStopped(job.id, 'paused', new PublishError('auth_expired', `Account is ${context.accountStatus}`));
    await notifier?.jobNeedsAttention(job.id, 'paused', 'The social account needs to be reconnected.');
    return 'stopped';
  }

  // An upload already in progress is allowed to finish; new publishes wait until unblocked.
  if (context.blockedReason && !job.resumeState) {
    await repo.markStopped(job.id, 'paused', new PublishError('permanent', context.blockedReason));
    await notifier?.jobNeedsAttention(job.id, 'paused', context.blockedReason);
    return 'stopped';
  }

  try {
    const request = { ...context.request, resumeState: job.resumeState };
    const result = job.resumeState
      ? await adapter.resume(context.account, request)
      : await adapter.publish(context.account, request);

    if (result.status === 'published') {
      await repo.markPublished(job.id, result);
      log('published', { jobId: job.id, externalPostId: result.externalPostId });
      return 'published';
    }
    await repo.markProcessing(job.id, new Date(now().getTime() + result.checkAfterSec * 1000), result.resumeState);
    return 'processing';
  } catch (e) {
    return handleFailure(job, toPublishError(e), deps, now, policy);
  }
}

async function handleFailure(
  job: ClaimedJob,
  error: PublishError,
  deps: RunnerDeps,
  now: () => Date,
  policy: RetryPolicy,
): Promise<Outcome> {
  const decision = decideOnFailure(error, job.attempt, now(), policy);
  deps.log?.('publish failed', { jobId: job.id, errorClass: error.errorClass, action: decision.action });

  if (decision.action === 'retry') {
    await deps.repo.markRetry(job.id, decision.at, error);
    return 'retrying';
  }
  if (decision.action === 'pause_account') {
    await deps.repo.pauseAccount(job.socialAccountId, error.message);
  }
  await deps.repo.markStopped(job.id, decision.status, error);
  await deps.notifier?.jobNeedsAttention(job.id, decision.status, error.message);
  return 'stopped';
}
