import 'server-only';
import {
  FacebookInbox,
  InstagramInbox,
  LinkedInInbox,
  MockInbox,
  nextInboxSyncAt,
  PublishError,
  ThreadsInbox,
  XInbox,
  YouTubeInbox,
  type InboxConnector,
  type Platform,
  type PostType,
} from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountCredentials } from '../accounts';
import { getAccess } from '../billing/access';
import { LINKEDIN_API_VERSION, META_GRAPH_VERSION } from '../oauth/providers';

const REAL: Partial<Record<Platform, () => InboxConnector>> = {
  facebook: () => new FacebookInbox({ graphVersion: META_GRAPH_VERSION }),
  instagram: () => new InstagramInbox({ graphVersion: META_GRAPH_VERSION }),
  threads: () => new ThreadsInbox(),
  linkedin: () => new LinkedInInbox({ apiVersion: LINKEDIN_API_VERSION }),
  youtube: () => new YouTubeInbox(),
  x: () => new XInbox(),
};

/** The connector for an account's platform (mock accounts get simulated comments). */
export function inboxConnector(platform: Platform, mock: boolean, now?: () => Date): InboxConnector | null {
  if (mock) return new MockInbox(platform, now);
  return REAL[platform]?.() ?? null;
}

interface DueRow {
  job_id: string;
  org_id: string;
  brand_id: string;
  social_account_id: string;
  platform: Platform;
  post_type: PostType;
  published_at: string;
  external_post_id: string;
}

export interface InboxSyncSummary {
  claimed: number;
  newComments: number;
  failed: number;
}

const HOUR = 3_600_000;

/** Fetches new comments for posts that are due. */
export async function syncDueInbox(db: SupabaseClient, now = new Date(), limit = 50): Promise<InboxSyncSummary> {
  const { data, error } = await db.rpc('claim_due_inbox', { p_now: now.toISOString(), p_limit: limit });
  if (error) throw new Error(`claim inbox: ${error.message}`);
  const rows = (data ?? []) as DueRow[];
  const summary: InboxSyncSummary = { claimed: rows.length, newComments: 0, failed: 0 };
  const credentialsCache = new Map<string, Awaited<ReturnType<typeof accountCredentials>>>();

  for (const r of rows) {
    const publishedAt = new Date(r.published_at);
    const setSync = (patch: { next_sync_at: string | null; note?: string | null; last_synced_at?: string }) =>
      db.from('inbox_sync').update(patch).eq('job_id', r.job_id);

    try {
      if ((await getAccess(r.org_id)).state === 'locked') {
        await setSync({ next_sync_at: new Date(now.getTime() + 24 * HOUR).toISOString() });
        continue;
      }
      if (!credentialsCache.has(r.social_account_id)) credentialsCache.set(r.social_account_id, await accountCredentials(db, r.social_account_id));
      const { credentials, mock } = credentialsCache.get(r.social_account_id)!;
      const connector = inboxConnector(r.platform, mock, () => now);
      if (!connector) {
        await setSync({ next_sync_at: null, note: 'Comments are not available for this platform.' });
        continue;
      }

      const comments = await connector.list(credentials, { externalPostId: r.external_post_id, postType: r.post_type, publishedAt });
      if (comments.length) {
        const { data: inserted, error: insertError } = await db
          .from('inbox_comments')
          .upsert(
            comments.map((c) => ({
              org_id: r.org_id,
              brand_id: r.brand_id,
              social_account_id: r.social_account_id,
              job_id: r.job_id,
              platform: r.platform,
              external_id: c.externalId,
              parent_external_id: c.parentExternalId,
              author_name: c.authorName.slice(0, 200),
              author_external_id: c.authorId,
              from_brand: c.fromBrand,
              text: c.text.slice(0, 10_000),
              commented_at: c.createdAt.toISOString(),
              permalink: c.permalink ?? null,
              hidden: c.hidden ?? false,
              // The brand's own comments need no action.
              status: c.fromBrand ? 'done' : 'open',
            })),
            { onConflict: 'social_account_id,external_id', ignoreDuplicates: true },
          )
          .select('id');
        if (insertError) throw new Error(insertError.message);
        summary.newComments += inserted?.length ?? 0;

        // A reply from the brand made directly on the platform settles the comment it answers.
        const answered = [...new Set(comments.filter((c) => c.fromBrand && c.parentExternalId).map((c) => c.parentExternalId!))];
        if (answered.length) {
          await db
            .from('inbox_comments')
            .update({ status: 'done', handled_at: now.toISOString() })
            .eq('social_account_id', r.social_account_id)
            .in('external_id', answered)
            .eq('status', 'open');
        }
      }
      await setSync({ next_sync_at: nextInboxSyncAt(publishedAt, now)?.toISOString() ?? null, note: null, last_synced_at: now.toISOString() });
    } catch (e) {
      summary.failed += 1;
      const note =
        e instanceof PublishError && e.errorClass === 'auth_expired'
          ? 'Reconnect this account to keep reading comments.'
          : e instanceof PublishError && (e.errorClass === 'invalid_content' || e.errorClass === 'permanent')
            ? `Comments unavailable: ${e.message}`.slice(0, 500)
            : 'Could not read comments; trying again later.';
      console.error(`[inbox] job ${r.job_id}:`, (e as Error).message);
      const next = nextInboxSyncAt(publishedAt, now);
      await setSync({ next_sync_at: next ? new Date(Math.max(next.getTime(), now.getTime() + HOUR)).toISOString() : null, note });
    }
  }
  return summary;
}
