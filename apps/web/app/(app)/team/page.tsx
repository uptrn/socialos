import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { createAdminClient } from '@/lib/supabase/server';
import { ROLE_INFO } from '@/lib/team';
import { getWorkspace, type Role } from '@/lib/workspace';
import { InviteForm, InviteRow, MemberRow } from './team-controls';

export const metadata: Metadata = { title: 'Team' };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function TeamPage() {
  const ws = await getWorkspace();
  const admin = createAdminClient();
  const canManage = ws.role === 'owner' || ws.role === 'admin';

  const [{ data: members }, { data: invites }] = await Promise.all([
    admin.rpc('org_member_list', { p_org: ws.org.id }),
    canManage
      ? admin
          .from('org_invitations')
          .select('id, email, role, expires_at, created_at')
          .eq('org_id', ws.org.id)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string; created_at: string }[] }),
  ]);
  const list = (members ?? []) as { user_id: string; email: string; role: Role; joined_at: string }[];

  return (
    <>
      <PageHeader title="Team" description={`${ws.org.name} · ${list.length} member${list.length === 1 ? '' : 's'}`} />
      <div className="max-w-4xl space-y-5">
        {canManage && (
          <Card className="p-5">
            <h2 className="font-semibold">Invite someone</h2>
            <p className="mt-0.5 text-sm text-muted">They get an email with a link that works for 7 days. Team members are included in every plan.</p>
            <div className="mt-4">
              <InviteForm />
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="font-semibold">Members</h2>
          <ul className="mt-2 divide-y divide-border">
            {list.map((m) => (
              <MemberRow
                key={m.user_id}
                userId={m.user_id}
                email={m.email}
                role={m.role}
                joined={fmt(m.joined_at)}
                isSelf={m.user_id === ws.userId}
                // Owners manage everyone; admins manage non-owners. Anyone can leave.
                canEdit={canManage && m.user_id !== ws.userId && (ws.role === 'owner' || m.role !== 'owner')}
                canMakeOwner={ws.role === 'owner'}
              />
            ))}
          </ul>
        </Card>

        {canManage && (invites ?? []).length > 0 && (
          <Card className="p-5">
            <h2 className="font-semibold">Pending invitations</h2>
            <ul className="mt-2 divide-y divide-border">
              {(invites ?? []).map((i) => (
                <InviteRow key={i.id} id={i.id} email={i.email} role={ROLE_INFO[i.role as Role].label} expired={new Date(i.expires_at) < new Date()} sent={fmt(i.created_at)} />
              ))}
            </ul>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="font-semibold">What each role can do</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
              <div key={r} className="contents">
                <dt className="font-medium">{ROLE_INFO[r].label}</dt>
                <dd className="text-muted">{ROLE_INFO[r].description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
