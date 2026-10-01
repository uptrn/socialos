import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, Logo } from '@/components/ui';
import { isCompanyMode } from '@/lib/mode';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { createUserClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/workspace';
import { signOut } from '../login/actions';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage() {
  const user = await requireUser();
  const supabase = await createUserClient();
  const { count } = await supabase.from('org_members').select('org_id', { count: 'exact', head: true }).eq('user_id', user.id);
  if (count) redirect('/calendar');
  // Company mode: only platform admins create the company; everyone else joins by invitation.
  const mayCreate = !isCompanyMode() || (await isPlatformAdmin());

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo width={180} />
        </div>
        {mayCreate ? (
          <OnboardingForm />
        ) : (
          <Card className="space-y-3 p-6 text-sm">
            <h1 className="text-xl font-bold">You&apos;re not part of a workspace yet</h1>
            <p className="text-muted">
              SocialOS is invite-only. Ask your administrator to invite <b className="text-text">{user.email}</b>, then open the link in the invitation email.
            </p>
            <form action={signOut}>
              <button type="submit" className="font-semibold text-brand hover:underline">
                Sign out
              </button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
