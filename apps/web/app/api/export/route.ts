import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Everything an organization has in SocialOS, as one JSON file (GDPR / portability).
// Secrets are left out: platform tokens, key hashes, invitation tokens, OAuth state.
const ROW_LIMIT = 50_000;
const FILE_LINK_DAYS = 7;

const TABLES: { table: string; select: string }[] = [
  { table: 'brands', select: 'id, name, slug, timezone, status, require_approval, link_tracking, created_at' },
  { table: 'brand_profiles', select: '*' },
  { table: 'org_members', select: 'user_id, role, status, created_at' },
  { table: 'org_invitations', select: 'id, email, role, expires_at, accepted_at, revoked_at, created_at' },
  { table: 'subscriptions', select: 'plan, status, trial_ends_at, current_period_end, cancel_at_period_end' },
  { table: 'social_accounts', select: 'id, brand_id, platform, external_account_id, display_name, status, status_reason, scopes, created_at' },
  { table: 'posts', select: '*' },
  { table: 'post_variants', select: '*' },
  { table: 'publish_jobs', select: 'id, post_id, variant_id, social_account_id, platform, scheduled_at, status, attempt_count, external_post_id, published_url, published_at, last_error_class, last_error_message, created_at' },
  { table: 'post_reviews', select: '*' },
  { table: 'post_metrics', select: '*' },
  { table: 'inbox_comments', select: '*' },
  { table: 'research_items', select: '*' },
  { table: 'tracked_links', select: '*' },
  { table: 'link_clicks', select: 'id, link_id, clicked_at, country, referrer_host' },
  { table: 'conversions', select: '*' },
  { table: 'agent_runs', select: 'id, brand_id, agent, model, status, cost_usd, input_tokens, output_tokens, created_at' },
  { table: 'audit_logs', select: '*' },
];

export async function GET() {
  const ws = await getWorkspace();
  if (ws.role !== 'owner' && ws.role !== 'admin') return NextResponse.json({ error: 'Only owners and admins can export the organization.' }, { status: 403 });
  const db = createAdminClient();
  const orgId = ws.org.id;

  const data: Record<string, unknown> = {};
  const truncated: string[] = [];
  for (const { table, select } of TABLES) {
    const { data: rows, error } = await db.from(table).select(select).eq('org_id', orgId).limit(ROW_LIMIT);
    if (error) return NextResponse.json({ error: `Export failed (${table}): ${error.message}` }, { status: 500 });
    data[table] = rows;
    if ((rows ?? []).length === ROW_LIMIT) truncated.push(table);
  }

  // Media: metadata plus download links valid for 7 days.
  const { data: media } = await db.from('media_assets').select('id, brand_id, kind, mime_type, size_bytes, width, height, duration_sec, storage_path, original_name, source, generation, created_at').eq('org_id', orgId).limit(ROW_LIMIT);
  const paths = (media ?? []).map((m) => m.storage_path as string);
  const links = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const { data: signed } = await db.storage.from('media').createSignedUrls(paths.slice(i, i + 500), FILE_LINK_DAYS * 86_400);
    for (const s of signed ?? []) if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
  }
  data.media_assets = (media ?? []).map((m) => ({ ...m, download_url: links.get(m.storage_path as string) ?? null }));

  const { data: memberEmails } = await db.rpc('org_member_list', { p_org: orgId });
  const body = {
    exported_at: new Date().toISOString(),
    exported_by: ws.email,
    organization: { id: orgId, name: ws.org.name },
    members: memberEmails,
    notes: [
      'Media download_url links expire after 7 days.',
      'Secrets (platform tokens, API key hashes, invitation tokens) are never exported.',
      ...(truncated.length ? [`Limited to ${ROW_LIMIT} rows: ${truncated.join(', ')}. Contact support for a full export.`] : []),
    ],
    data,
  };

  await db.from('audit_logs').insert({ org_id: orgId, actor_type: 'user', actor_id: ws.userId, action: 'organization.exported', resource_type: 'organization', resource_id: orgId });
  const date = new Date().toISOString().slice(0, 10);
  const slug = ws.org.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="socialos-${slug}-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
