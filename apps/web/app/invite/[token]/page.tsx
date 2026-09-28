import type { Metadata } from 'next';
import { Card, Logo } from '@/components/ui';
import { createAdminClient } from '@/lib/supabase/server';
import { hashInviteToken, ROLE_INFO } from '@/lib/team';
import { requireUser, type Role } from '@/lib/workspace';
import { signOut } from '../../login/actions';
import { AcceptButton } from './accept-button';

export const metadata: Metadata = { title: 'Invitation' };

const STATUS_TEXT = {
  accepted: 'This invitation has already been used.',
  revoked: 'This invitation was cancelled.',
  expired: 'This invitation has expired. Ask the person who invited you for a new link.',
} as const;

export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const user = await requireUser();
  const { data } = await createAdminClient().rpc('invitation_preview', { p_token_hash: hashInviteToken(token) });
  const invite = (Array.isArray(data) ? data[0] : data) as { org_name: string; email: string; role: Role; status: 'open' | keyof typeof STATUS_TEXT } | undefined;
  const wrongEmail = invite && user.email?.toLowerCase() !== invite.email;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo width={196} />
        </div>
        <Card className="p-6">
          {!invite ? (
            <p className="text-sm">This invitation link isn&apos;t valid. Check that you copied the whole link.</p>
          ) : invite.status !== 'open' ? (
            <p className="text-sm">{STATUS_TEXT[invite.status]}</p>
          ) : wrongEmail ? (
            <div className="space-y-4 text-sm">
              <p>
                This invitation to <b>{invite.org_name}</b> was sent to <b>{invite.email}</b>, but you&apos;re signed in as <b>{user.email}</b>.
              </p>
              <form action={signOut}>
                <input type="hidden" name="next" value={`/invite/${token}`} />
                <button type="submit" className="font-semibold text-brand underline">
                  Sign out and continue as {invite.email}
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <h1 className="text-xl font-bold">Join {invite.org_name}</h1>
              <p className="text-sm text-muted">
                You&apos;ve been invited as <b className="text-text">{ROLE_INFO[invite.role].label}</b>. {ROLE_INFO[invite.role].description}
              </p>
              <AcceptButton token={token} />
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
