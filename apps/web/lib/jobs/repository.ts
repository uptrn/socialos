import 'server-only';
import {
  PLATFORM_OPTIONS,
  PublishError,
  type ClaimedJob,
  type JobRepository,
  type Platform,
  type PublishContext,
  type PublishResult,
} from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccess } from '../billing/access';
import { trackPostLinks } from '../links';
import { withSignedUrls } from '../media-server';
import { mediaProxyUrl } from '../media-proxy';
import { getFreshCredentials, type AccountTokenRow } from '../oauth/tokens';
import { toMediaInfo, VARIANT_SELECT, type VariantRecord } from '../posts';
import { MOCK_ACCOUNT_PREFIX } from './adapters';

// Platforms fetch media from these URLs, sometimes minutes after we call them.
const MEDIA_URL_TTL_SEC = 2 * 60 * 60;

interface JobRow {
  id: string;
  post_id: string;
  platform: Platform;
  social_account_id: string;
  scheduled_at: string;
  attempt_count: number;
  idempotency_key: string;
  resume_state: Record<string, unknown> | null;
}

/** Postgres-backed job store for the scheduler. Uses the service-role client. */
export class SupabaseJobRepository implements JobRepository {
  constructor(private readonly db: SupabaseClient) {}

  async claimDueJobs(now: Date, limit: number): Promise<ClaimedJob[]> {
    const { data, error } = await this.db.rpc('claim_due_publish_jobs', { p_now: now.toISOString(), p_limit: limit });
    if (error) throw new Error(`claim failed: ${error.message}`);
    return ((data ?? []) as JobRow[]).map((row) => ({
      id: row.id,
      platform: row.platform,
      socialAccountId: row.social_account_id,
      scheduledAt: new Date(row.scheduled_at),
      attempt: row.attempt_count,
      resumeState: row.resume_state ?? undefined,
    }));
  }

  async loadContext(job: ClaimedJob): Promise<PublishContext> {
    const { data, error } = await this.db
      .from('publish_jobs')
      .select(`id, org_id, brand_id, post_id, idempotency_key, posts(title), post_variants(${VARIANT_SELECT}), social_accounts(id, platform, external_account_id, status, token_ref, token_expires_at)`)
      .eq('id', job.id)
      .single();
    if (error || !data) throw new Error(`job ${job.id} not found: ${error?.message}`);

    const variant = data.post_variants as unknown as VariantRecord;
    const account = data.social_accounts as unknown as {
      id: string; platform: Platform; external_account_id: string; status: PublishContext['accountStatus'];
      token_ref: string | null; token_expires_at: string | null;
    };

    const ordered = [...variant.variant_media].sort((a, b) => a.position - b.position);
    const signed = await withSignedUrls(ordered.map((m) => m.media_assets), MEDIA_URL_TTL_SEC);
    const media = ordered.map((m, i) => {
      const url = signed[i]?.url;
      if (!url) throw new PublishError('transient', 'Could not create a media URL');
      return {
        ...toMediaInfo(m.media_assets),
        aiGenerated: m.media_assets.source === 'ai_image',
        url,
        proxyUrl: mediaProxyUrl(m.media_assets.storage_path, m.media_assets.mime_type, MEDIA_URL_TTL_SEC),
        altText: m.alt_text ?? undefined,
      };
    });

    // Re-parse options so platform defaults are applied.
    const parsedOptions = PLATFORM_OPTIONS[variant.platform].parse(variant.options) as Record<string, unknown>;
    const access = await getAccess(data.org_id);
    // Outbound links become tracked short links (same links on every retry of this job).
    const tracked = await trackPostLinks(this.db, {
      jobId: job.id,
      orgId: data.org_id,
      brandId: data.brand_id,
      postId: data.post_id,
      postTitle: (data.posts as unknown as { title: string | null } | null)?.title ?? null,
      platform: variant.platform,
      postType: variant.post_type,
      caption: variant.caption,
      threadParts: variant.thread_parts,
      options: parsedOptions,
    });

    return {
      accountStatus: account.status,
      blockedReason: access.state === 'locked' ? (access.message ?? 'Subscription inactive') : undefined,
      account: {
        socialAccountId: account.id,
        platform: account.platform,
        externalAccountId: account.external_account_id,
        accessToken: await this.readToken(account),
        tokenExpiresAt: account.token_expires_at ? new Date(account.token_expires_at) : undefined,
      },
      request: {
        jobId: job.id,
        idempotencyKey: data.idempotency_key,
        platform: variant.platform,
        postType: variant.post_type,
        caption: tracked.caption,
        threadParts: tracked.threadParts,
        media,
        options: tracked.options as never,
      },
    };
  }

  private async readToken(account: AccountTokenRow & { external_account_id: string }): Promise<string> {
    if (account.external_account_id.startsWith(MOCK_ACCOUNT_PREFIX)) return 'mock-token';
    return (await getFreshCredentials(this.db, account)).access_token;
  }

  async markPublished(jobId: string, result: Extract<PublishResult, { status: 'published' }>) {
    await this.finish(jobId, {
      status: 'published',
      external_post_id: result.externalPostId,
      published_url: result.url ?? null,
      published_at: result.publishedAt.toISOString(),
      resume_state: null,
      last_error_class: null,
      last_error_message: result.warning ?? null,
    }, 'published');
  }

  async markProcessing(jobId: string, checkAt: Date, resumeState: Record<string, unknown>) {
    await this.update(jobId, { status: 'processing', next_attempt_at: checkAt.toISOString(), resume_state: resumeState, locked_at: null });
  }

  async markRetry(jobId: string, nextAttemptAt: Date, error: PublishError) {
    await this.update(jobId, {
      status: 'retrying',
      next_attempt_at: nextAttemptAt.toISOString(),
      locked_at: null,
      last_error_class: error.errorClass,
      last_error_message: error.message.slice(0, 1000),
    });
  }

  async markStopped(jobId: string, status: 'failed' | 'needs_revision' | 'needs_check' | 'missed' | 'paused', error: PublishError | null) {
    await this.finish(jobId, {
      status,
      last_error_class: error?.errorClass ?? null,
      last_error_message: error?.message.slice(0, 1000) ?? null,
    }, 'failed');
  }

  async pauseAccount(socialAccountId: string, reason: string) {
    await this.db.from('social_accounts').update({ status: 'expired', status_reason: reason.slice(0, 500) }).eq('id', socialAccountId);
  }

  private async update(jobId: string, patch: Record<string, unknown>) {
    const { data, error } = await this.db.from('publish_jobs').update(patch).eq('id', jobId).select('post_id, variant_id').single();
    if (error) throw new Error(`update job ${jobId}: ${error.message}`);
    return data as { post_id: string; variant_id: string };
  }

  /** Terminal update: also sync the variant and the post's overall status. */
  private async finish(jobId: string, patch: Record<string, unknown>, variantStatus: 'published' | 'failed') {
    const { post_id, variant_id } = await this.update(jobId, { ...patch, locked_at: null });
    await this.db.from('post_variants').update({ status: variantStatus }).eq('id', variant_id);
    await this.db.rpc('refresh_post_status', { p_post: post_id });
  }
}
