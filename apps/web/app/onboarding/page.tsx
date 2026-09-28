import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/ui';
import { createUserClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/workspace';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage() {
  const user = await requireUser();
  const supabase = await createUserClient();
  const { count } = await supabase.from('org_members').select('org_id', { count: 'exact', head: true }).eq('user_id', user.id);
  if (count) redirect('/calendar');

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo width={180} />
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
