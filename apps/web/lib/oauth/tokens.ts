import 'server-only';
import { PublishError, type Platform } from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLATFORM_PROVIDER, PROVIDERS, ProviderError, type StoredCredentials } from './providers';

/** Refresh when the token has less than this left. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export interface AccountTokenRow {
  id: string;
  platform: Platform;
  token_ref: string | null;
  token_expires_at: string | null;
}

export async function readCredentials(db: SupabaseClient, tokenRef: string): Promise<StoredCredentials> {
  const { data, error } = await db.rpc('read_secret', { p_id: tokenRef });
  if (error) throw new PublishError('transient', `Could not read credentials: ${error.message}`);
  if (!data) throw new PublishError('auth_expired', 'Stored credentials are missing; reconnect the account');
  return JSON.parse(data as string) as StoredCredentials;
}

/**
 * Credentials that are valid for at least the next few minutes, refreshing (and saving)
 * them first if needed. A refresh the provider rejects means the user must reconnect.
 */
export async function getFreshCredentials(
  db: SupabaseClient,
  account: AccountTokenRow,
  opts: { marginMs?: number; force?: boolean } = {},
): Promise<StoredCredentials> {
  if (!account.token_ref) throw new PublishError('auth_expired', 'No access token stored for this account');
  const credentials = await readCredentials(db, account.token_ref);
  const expiresAt = credentials.expires_at ?? account.token_expires_at;
  const margin = opts.marginMs ?? REFRESH_MARGIN_MS;
  if (!opts.force && (!expiresAt || new Date(expiresAt).getTime() - Date.now() > margin)) return credentials;

  const provider = PROVIDERS[PLATFORM_PROVIDER[account.platform]];
  if (!provider.refresh) {
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      throw new PublishError('auth_expired', 'Access token has expired; reconnect the account');
    }
    return credentials; // still valid for a little while and cannot be refreshed
  }

  try {
    const refreshed = await provider.refresh(credentials);
    const { error } = await db.rpc('update_account_credentials', {
      p_account: account.id,
      p_credentials: JSON.stringify(refreshed.credentials),
      p_token_expires_at: refreshed.expiresAt ?? null,
    });
    if (error) throw new PublishError('transient', `Could not save refreshed token: ${error.message}`);
    return refreshed.credentials;
  } catch (e) {
    if (e instanceof PublishError) throw e;
    if (e instanceof ProviderError) throw new PublishError('auth_expired', e.message, { cause: e });
    throw new PublishError('transient', `Token refresh failed: ${(e as Error).message}`, { cause: e });
  }
}
