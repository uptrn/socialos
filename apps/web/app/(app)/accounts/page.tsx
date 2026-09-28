import { PLATFORMS, PLATFORM_SPECS, type Platform } from '@socialos/core';
import type { Metadata } from 'next';
import { PLATFORM_META, PlatformIcon } from '@/components/platform';
import clsx from 'clsx';
import { buttonClass, Card, PageHeader } from '@/components/ui';
import { PLATFORM_PROVIDER, PROVIDERS } from '@/lib/oauth/providers';
import { serverEnv } from '@/lib/env';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { DisconnectButton, MockAccountForm } from './account-forms';

export const metadata: Metadata = { title: 'Accounts' };

/** Tokens that refresh automatically are only worth mentioning once they've lapsed. */
function expiryNote(expiresAt: string | null, platform: Platform): string {
  if (!expiresAt || PROVIDERS[PLATFORM_PROVIDER[platform]].refresh && platform !== 'linkedin') return '';
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return days <= 14 ? ` · access expires in ${Math.max(days, 0)} day(s)` : '';
}

const CONNECTABLE = new Set(Object.values(PROVIDERS).flatMap((p) => p.platforms));

export default async function AccountsPage({ searchParams }: PageProps<'/accounts'>) {
  const { error, connected } = await searchParams;
  const ws = await getWorkspace();
  const supabase = await createUserClient();
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform, display_name, status, status_reason, scopes, token_expires_at, created_at')
    .eq('brand_id', ws.brand.id)
    .neq('status', 'revoked')
    .order('created_at');
  const canManage = ['owner', 'admin'].includes(ws.role);

  return (
    <>
      <PageHeader title="Connected accounts" description={`Social accounts that ${ws.brand.name} can publish to.`} />
      {typeof error === 'string' && <p className="mb-5 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {connected && <p className="mb-5 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">Accounts connected.</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          {accounts?.length ? (
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-4">
                  <PlatformIcon platform={a.platform as Platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{a.display_name}</p>
                    <p className="text-xs text-muted">
                      {PLATFORM_META[a.platform as Platform].label}
                      {a.scopes?.includes('mock') && ' · simulated account'}
                      {a.status === 'active' && expiryNote(a.token_expires_at, a.platform as Platform)}
                    </p>
                    {a.status !== 'active' && a.status_reason && <p className="text-xs text-warning">{a.status_reason}</p>}
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      a.status === 'active' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
                    )}
                  >
                    {a.status === 'active' ? 'Connected' : 'Reconnect needed'}
                  </span>
                  {canManage && a.status !== 'active' && PROVIDERS[PLATFORM_PROVIDER[a.platform as Platform]].configured() && (
                    <a href={`/api/oauth/${PLATFORM_PROVIDER[a.platform as Platform]}/start`} className={buttonClass('secondary', 'sm')}>
                      Reconnect
                    </a>
                  )}
                  {canManage && <DisconnectButton accountId={a.id} />}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center text-sm text-muted">No accounts connected yet.</div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="font-semibold">Connect a platform</h2>
            <p className="mt-1 text-xs text-muted">You&apos;ll sign in on the platform and choose which pages or accounts to add.</p>
            <ul className="mt-4 space-y-3">
              {Object.values(PROVIDERS).map((provider) => (
                <li key={provider.id} className="flex items-center gap-3 text-sm">
                  <span className="flex -space-x-1.5">
                    {provider.platforms.map((p) => (
                      <PlatformIcon key={p} platform={p} size={24} className="ring-2 ring-surface" />
                    ))}
                  </span>
                  <span className="flex-1 font-medium">{provider.label}</span>
                  {provider.configured() && canManage ? (
                    <a href={`/api/oauth/${provider.id}/start`} className={buttonClass('secondary', 'sm')}>
                      Connect
                    </a>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                      {provider.configured() ? 'Admins only' : 'Awaiting app setup'}
                    </span>
                  )}
                </li>
              ))}
              {PLATFORMS.filter((p) => !CONNECTABLE.has(p)).map((p) => (
                <li key={p} className="flex items-center gap-3 text-sm">
                  <PlatformIcon platform={p} size={24} />
                  <span className="flex-1">{PLATFORM_SPECS[p].label}</span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">Coming soon</span>
                </li>
              ))}
            </ul>
          </Card>

          {serverEnv.mockAccountsEnabled() && canManage && (
            <Card className="border-dashed p-5">
              <h2 className="font-semibold">Add a simulated account</h2>
              <p className="mt-1 text-xs text-muted">
                Development only. Posts go through the full scheduling flow but nothing is sent to the platform.
              </p>
              <MockAccountForm />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
