import { describe, expect, it } from 'vitest';
import {
  MockAdapter,
  PublishError,
  backoffDelaySec,
  decideOnFailure,
  localToUtc,
  runDueJobs,
  utcToLocal,
  type ClaimedJob,
  type JobRepository,
  type PublishContext,
} from '../src';

const NOW = new Date('2026-10-05T09:00:00Z');

function makeRepo(jobs: ClaimedJob[], captions: Record<string, string>, accountStatus: PublishContext['accountStatus'] = 'active') {
  const calls: { method: string; jobId?: string; status?: string; at?: Date }[] = [];
  const repo: JobRepository = {
    async claimDueJobs() {
      return jobs;
    },
    async loadContext(job) {
      return {
        accountStatus,
        account: { socialAccountId: job.socialAccountId, platform: job.platform, externalAccountId: 'ext', accessToken: 'tok' },
        request: {
          jobId: job.id,
          idempotencyKey: `${job.id}:key`,
          platform: job.platform,
          postType: 'text',
          caption: captions[job.id] ?? 'hello',
          media: [],
          options: {} as never,
        },
      };
    },
    async markPublished(jobId) { calls.push({ method: 'published', jobId }); },
    async markProcessing(jobId, at) { calls.push({ method: 'processing', jobId, at }); },
    async markRetry(jobId, at) { calls.push({ method: 'retry', jobId, at }); },
    async markStopped(jobId, status) { calls.push({ method: 'stopped', jobId, status }); },
    async pauseAccount() { calls.push({ method: 'pauseAccount' }); },
  };
  return { repo, calls };
}

const job = (id: string, over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id, platform: 'linkedin', socialAccountId: 'acc1', scheduledAt: new Date(NOW.getTime() - 30_000), attempt: 1, ...over,
});

describe('runDueJobs', () => {
  it('publishes due jobs', async () => {
    const adapter = new MockAdapter('linkedin');
    const { repo, calls } = makeRepo([job('j1'), job('j2')], {});
    const summary = await runDueJobs({ repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(summary).toMatchObject({ claimed: 2, published: 2 });
    expect(adapter.published).toHaveLength(2);
    expect(calls.map((c) => c.method)).toEqual(['published', 'published']);
  });

  it('schedules a retry for transient errors', async () => {
    const { repo, calls } = makeRepo([job('j1')], { j1: 'x [mock:fail-transient]' });
    const summary = await runDueJobs({ repo, adapters: { linkedin: new MockAdapter('linkedin') }, now: () => NOW });
    expect(summary.retrying).toBe(1);
    expect(calls[0]).toMatchObject({ method: 'retry', at: new Date(NOW.getTime() + 60_000) });
  });

  it('never retries ambiguous failures (avoids double posting)', async () => {
    const { repo, calls } = makeRepo([job('j1')], { j1: 'x [mock:fail-ambiguous]' });
    await runDueJobs({ repo, adapters: { linkedin: new MockAdapter('linkedin') }, now: () => NOW });
    expect(calls).toEqual([{ method: 'stopped', jobId: 'j1', status: 'needs_check' }]);
  });

  it('pauses the account when auth has expired', async () => {
    const { repo, calls } = makeRepo([job('j1')], { j1: 'x [mock:fail-auth_expired]' });
    await runDueJobs({ repo, adapters: { linkedin: new MockAdapter('linkedin') }, now: () => NOW });
    expect(calls.map((c) => c.method)).toEqual(['pauseAccount', 'stopped']);
    expect(calls[1]?.status).toBe('paused');
  });

  it('does not publish to a disconnected account', async () => {
    const adapter = new MockAdapter('linkedin');
    const { repo, calls } = makeRepo([job('j1')], {}, 'expired');
    await runDueJobs({ repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(adapter.published).toHaveLength(0);
    expect(calls[0]?.status).toBe('paused');
  });

  it('pauses new publishes while the organization is blocked (e.g. unpaid)', async () => {
    const adapter = new MockAdapter('linkedin');
    const { repo, calls } = makeRepo([job('j1')], {});
    const base = repo.loadContext.bind(repo);
    repo.loadContext = async (j) => ({ ...(await base(j)), blockedReason: 'Subscription inactive' });
    await runDueJobs({ repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(adapter.published).toHaveLength(0);
    expect(calls).toEqual([{ method: 'stopped', jobId: 'j1', status: 'paused' }]);
  });

  it('marks jobs picked up far too late as missed instead of posting', async () => {
    const adapter = new MockAdapter('linkedin');
    const late = job('j1', { scheduledAt: new Date(NOW.getTime() - 7 * 3600_000) });
    const { repo, calls } = makeRepo([late], {});
    await runDueJobs({ repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(adapter.published).toHaveLength(0);
    expect(calls[0]?.status).toBe('missed');
  });

  it('handles processing then resume', async () => {
    const adapter = new MockAdapter('linkedin');
    const first = makeRepo([job('j1')], { j1: 'video [mock:processing]' });
    await runDueJobs({ repo: first.repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(first.calls[0]?.method).toBe('processing');

    const second = makeRepo([job('j1', { attempt: 2, resumeState: { step: 'uploaded' } })], { j1: 'video [mock:processing]' });
    await runDueJobs({ repo: second.repo, adapters: { linkedin: adapter }, now: () => NOW });
    expect(second.calls[0]?.method).toBe('published');
  });

  it('fails jobs whose platform has no adapter', async () => {
    const { repo, calls } = makeRepo([job('j1', { platform: 'tiktok' })], {});
    await runDueJobs({ repo, adapters: {}, now: () => NOW });
    expect(calls[0]?.status).toBe('failed');
  });
});

describe('retry policy', () => {
  it('backs off exponentially with a cap', () => {
    expect([1, 2, 3, 4, 5, 10].map((a) => backoffDelaySec(a))).toEqual([60, 120, 240, 480, 960, 1800]);
  });
  it('gives up after max attempts', () => {
    expect(decideOnFailure(new PublishError('transient', 'x'), 5, NOW)).toEqual({ action: 'stop', status: 'failed' });
  });
  it('honours rate-limit retry-after', () => {
    const d = decideOnFailure(new PublishError('rate_limited', 'x', { retryAfterSec: 300 }), 1, NOW);
    expect(d).toEqual({ action: 'retry', status: 'retrying', at: new Date(NOW.getTime() + 300_000) });
  });
});

describe('timezones', () => {
  it('converts brand local time to UTC and back', () => {
    const { utc, shifted } = localToUtc('2026-10-05T09:30', 'Asia/Kolkata');
    expect(utc.toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(shifted).toBe(false);
    expect(utcToLocal(utc, 'Asia/Kolkata')).toBe('2026-10-05T09:30');
  });
  it('flags times that do not exist because of DST', () => {
    // US clocks jump from 02:00 to 03:00 on 2026-03-08
    expect(localToUtc('2026-03-08T02:30', 'America/New_York').shifted).toBe(true);
  });
});
