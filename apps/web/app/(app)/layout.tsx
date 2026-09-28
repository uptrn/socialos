import Link from 'next/link';
import { getAccess } from '@/lib/billing/access';
import { inboxSince } from '@/lib/inbox/window';
import { LEGAL } from '@/lib/legal';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { Sidebar } from './sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await getWorkspace();
  const supabase = await createUserClient();
  const [access, { count: waiting }, { count: inboxOpen }] = await Promise.all([
    getAccess(ws.org.id),
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', ws.brand.id).eq('status', 'pending_approval'),
    supabase
      .from('inbox_comments')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', ws.brand.id)
      .eq('status', 'open')
      .eq('from_brand', false)
      .gte('commented_at', inboxSince()),
  ]);
  const approvals = ws.brand.require_approval || (waiting ?? 0) > 0 ? { count: waiting ?? 0 } : undefined;
  // Remind in the last days of the trial; always show payment problems.
  const showBanner = access.state === 'locked' || access.state === 'grace' || (access.state === 'trialing' && (access.trialDaysLeft ?? 99) <= 3);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ws.org.name}
        orgId={ws.org.id}
        orgs={ws.orgs}
        email={ws.email}
        brands={ws.brands.map((b) => ({ id: b.id, name: b.name }))}
        currentBrandId={ws.brand.id}
        approvals={approvals}
        inboxOpen={inboxOpen ?? 0}
        platformAdmin={await isPlatformAdmin()}
      />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {showBanner && (
          <div className={`mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm ${access.state === 'locked' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
            <span>{access.message ?? `Your free trial ends in ${access.trialDaysLeft} day(s).`}</span>
            {access.suspended ? (
              <a href={`mailto:${LEGAL.email}`} className="font-semibold underline">
                Contact support
              </a>
            ) : (
              <Link href="/settings/billing" className="font-semibold underline">
                {access.state === 'trialing' ? 'Choose a plan' : 'Go to billing'}
              </Link>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
