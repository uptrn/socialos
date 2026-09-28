import 'server-only';
import { PublishError, type AccountCredentials, type Platform } from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MOCK_ACCOUNT_PREFIX } from './jobs/adapters';
import { getFreshCredentials, type AccountTokenRow } from './oauth/tokens';

/** Credentials for a connected account (refreshing the token if needed). Mock accounts get a fake token. */
export async function accountCredentials(db: SupabaseClient, accountId: string): Promise<{ credentials: AccountCredentials; mock: boolean }> {
  const { data: account } = await db
    .from('social_accounts')
    .select('id, platform, external_account_id, token_ref, token_expires_at, status')
    .eq('id', accountId)
    .single();
  if (!account) throw new PublishError('permanent', 'Account not found');
  if (account.status !== 'active') throw new PublishError('auth_expired', 'Reconnect this account first.');
  const mock = account.external_account_id.startsWith(MOCK_ACCOUNT_PREFIX);
  const accessToken = mock ? 'mock-token' : (await getFreshCredentials(db, account as AccountTokenRow)).access_token;
  return {
    mock,
    credentials: { socialAccountId: account.id, platform: account.platform as Platform, externalAccountId: account.external_account_id, accessToken },
  };
}
