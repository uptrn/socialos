import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaThumb } from '@/components/media-thumb';
import { PLATFORM_META, PlatformIcon } from '@/components/platform';
import { Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import type { MediaRow } from '@/lib/media';
import { withSignedUrls } from '@/lib/media-server';
import { VARIANT_SELECT, type VariantRecord } from '@/lib/posts';
import { createAdminClient, createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { ReviewControls, WithdrawButton } from './review-controls';

export const metadata: Metadata = { title: 'Approvals' };

interface PendingPost {
  id: string;
  title: string | null;
  approval_requested_at: string | null;
  submitted_by: string | null;
  submitted_at: string;
  post_variants: (VariantRecord & { social_accounts: { display_name: string } | null })[];
}

export default async function ApprovalsPage() {
  const ws = await getWorkspace();
  const supabase = await createUserClient();
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: ws.brand.timezone, dateStyle: 'medium', timeStyle: 'short' });

  const [{ data: posts }, { data: members }, { data: recent }] = await Promise.all([
    supabase
      .from('posts')
      .select(`id, title, approval_requested_at, submitted_by, submitted_at, post_variants(${VARIANT_SELECT}, social_accounts(display_name))`)
      .eq('brand_id', ws.brand.id)
      .eq('status', 'pending_approval')
      .order('submitted_at'),
    createAdminClient().rpc('org_member_list', { p_org: ws.org.id }),
    supabase
      .from('post_reviews')
      .select('id, action, note, actor_id, created_at, post_id, posts(title)')
      .eq('brand_id', ws.brand.id)
      .in('action', ['approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  const pending = (posts ?? []) as unknown as PendingPost[];
  const emailOf = new Map(((members ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]));

  // Signed URLs for every media item shown.
  const mediaRows = pending.flatMap((p) => p.post_variants.flatMap((v) => v.variant_media.map((m) => m.media_assets)));
  const signed = new Map((await withSignedUrls([...new Map(mediaRows.map((m) => [m.id, m])).values()] as MediaRow[])).map((m) => [m.id, m]));

  const description = ws.brand.require_approval
    ? `${ws.brand.name} · posts from managers need approval before they're scheduled`
    : `${ws.brand.name} · approval is off for this brand (turn it on in Settings)`;

  return (
    <>
      <PageHeader title="Approvals" description={description} />

      {pending.length === 0 ? (
        <EmptyState title="Nothing waiting" body={ws.canApprove ? 'Posts submitted for approval will show up here.' : 'Posts you submit for approval will show up here until they are reviewed.'} />
      ) : (
        <div className="space-y-5">
          {pending.map((p) => {
            const mine = p.submitted_by === ws.userId;
            return (
              <Card key={p.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.title || 'Untitled post'}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      From {mine ? 'you' : (emailOf.get(p.submitted_by ?? '') ?? 'a former member')} · {fmt(p.submitted_at)} · requested for{' '}
                      <span className="font-medium text-text">{p.approval_requested_at ? fmt(p.approval_requested_at) : 'as soon as approved'}</span>
                    </p>
                  </div>
                  <StatusBadge status="pending_approval" />
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {p.post_variants.map((v) => {
                    const media = [...v.variant_media].sort((a, b) => a.position - b.position);
                    const text = v.thread_parts.length ? v.thread_parts.join('\n\n— next post —\n\n') : v.caption;
                    return (
                      <div key={v.id} className="rounded-lg border border-border p-3">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <PlatformIcon platform={v.platform} size={20} />
                          {v.social_accounts?.display_name ?? PLATFORM_META[v.platform].label}
                          <span className="font-normal text-muted">· {v.post_type}</span>
                        </p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{text || <span className="text-muted">(no caption)</span>}</p>
                        {media.length > 0 && (
                          <div className="mt-2 grid grid-cols-4 gap-1.5">
                            {media.map((m) => {
                              const s = signed.get(m.media_assets.id);
                              return s ? <MediaThumb key={m.position} media={s} /> : null;
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 border-t border-border pt-4">
                  {ws.canApprove && !mine ? (
                    <ReviewControls postId={p.id} timezone={ws.brand.timezone} />
                  ) : ws.canEdit ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                      <span>{mine ? 'Waiting for an owner, admin or reviewer.' : 'Waiting for review.'} Content is locked until then.</span>
                      <WithdrawButton postId={p.id} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Waiting for review.</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(recent ?? []).length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="font-semibold">Recent decisions</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(recent ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className={r.action === 'approved' ? 'font-semibold text-success' : 'font-semibold text-warning'}>
                    {r.action === 'approved' ? 'Approved' : 'Changes requested'}
                  </span>{' '}
                  <Link href={r.action === 'rejected' ? `/compose?post=${r.post_id}` : '/queue'} className="hover:underline">
                    {(r.posts as unknown as { title: string | null } | null)?.title || 'Untitled post'}
                  </Link>
                  {r.note && <span className="text-muted"> · “{r.note}”</span>}
                </span>
                <span className="text-xs text-muted">
                  {emailOf.get(r.actor_id ?? '') ?? 'someone'} · {fmt(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
