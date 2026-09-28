import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** The signed-in person's own data (GDPR access request), across all organizations. */
export async function GET() {
  const user = await requireUser();
  const db = createAdminClient();
  const [{ data: memberships }, { data: invitations }, { data: actions }, { data: posts }, { data: replies }] = await Promise.all([
    db.from('org_members').select('role, status, created_at, organizations(name)').eq('user_id', user.id),
    db.from('org_invitations').select('role, created_at, accepted_at, revoked_at, organizations(name)').eq('email', (user.email ?? '').toLowerCase()),
    db.from('audit_logs').select('action, resource_type, created_at, details').eq('actor_id', user.id).order('created_at', { ascending: false }).limit(5000),
    db.from('posts').select('id, title, status, scheduled_at, created_at').eq('created_by', user.id).limit(5000),
    db.from('inbox_comments').select('platform, text, commented_at').eq('replied_by', user.id).limit(5000),
  ]);

  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at, email_confirmed_at: user.email_confirmed_at, last_sign_in_at: user.last_sign_in_at },
    memberships,
    invitations_received: invitations,
    posts_created: posts,
    replies_sent: replies,
    activity: actions,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="socialos-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
