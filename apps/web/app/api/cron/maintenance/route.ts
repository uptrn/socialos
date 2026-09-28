import { PublishError, type Platform } from '@socialos/core';
import { NextResponse, type NextRequest } from 'next/server';
import { cronHandler } from '@/lib/heartbeat';
import { isCronAuthorized } from '@/lib/cron-auth';
import { MOCK_ACCOUNT_PREFIX } from '@/lib/jobs/adapters';
import { sendAccountAlert } from '@/lib/notify';
import { PLATFORM_PROVIDER, PROVIDERS } from '@/lib/oauth/providers';
import { getFreshCredentials } from '@/lib/oauth/tokens';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 300;

const WARN_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Daily housekeeping (called by cron, like /api/cron/publish):
 * - refresh tokens that expire within 7 days, where the platform allows it
 * - mark accounts whose tokens have expired, and email owners/admins
 * - warn about tokens that expire soon and can't be refreshed (e.g. LinkedIn)
 * - delete abandoned "Connect account" attempts
 */
async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createAdminClient();
  const summary = { refreshed: 0, expired: 0, warned: 0, refreshFailed: 0, purgedStates: 0 };

  const soon = new Date(Date.now() + WARN_BEFORE_MS).toISOString();
  const { data: accounts } = await db
    .from('social_accounts')
    .select('id, org_id, platform, display_name, external_account_id, token_ref, token_expires_at')
    .eq('status', 'active')
    .not('token_expires_at', 'is', null)
    .lt('token_expires_at', soon);

  for (const account of accounts ?? []) {
    if (account.external_account_id.startsWith(MOCK_ACCOUNT_PREFIX)) continue;
    const provider = PROVIDERS[PLATFORM_PROVIDER[account.platform as Platform]];
    const expired = new Date(account.token_expires_at!).getTime() <= Date.now();

    let refreshError: string | null = null;
    if (provider.refresh) {
      try {
        await getFreshCredentials(db, { ...account, platform: account.platform as Platform }, { force: true });
        summary.refreshed += 1;
        continue;
      } catch (e) {
        summary.refreshFailed += 1;
        refreshError = e instanceof PublishError || e instanceof Error ? e.message : String(e);
      }
    }

    if (expired) {
      await db.from('social_accounts').update({ status: 'expired', status_reason: 'Access expired; reconnect the account' }).eq('id', account.id);
      await sendAccountAlert(db, account, 'expired', 'The platform no longer accepts our access for this account.');
      summary.expired += 1;
    } else {
      // Still works for now, but we couldn't renew it: ask a person to reconnect before it lapses.
      const days = Math.max(1, Math.ceil((new Date(account.token_expires_at!).getTime() - Date.now()) / 86_400_000));
      const reason = refreshError ? `Automatic renewal failed (${refreshError}).` : `${provider.label} requires reconnecting to renew access.`;
      await sendAccountAlert(db, account, 'expiring', `Access expires in about ${days} day(s). ${reason}`);
      summary.warned += 1;
    }
  }

  const { data: purged } = await db.rpc('purge_expired_oauth_states');
  summary.purgedStates = (purged as number | null) ?? 0;
  return NextResponse.json(summary);
}

const wrapped = cronHandler('maintenance', handle);
export const GET = wrapped;
export const POST = wrapped;
