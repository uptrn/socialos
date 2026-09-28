import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getProvider, ProviderError, redirectUriFor } from '@/lib/oauth/providers';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/workspace';

// The provider sends the user back here. We verify the state, exchange the code,
// park the resulting accounts (credentials encrypted in Vault) and let the user pick.
export async function GET(request: NextRequest, ctx: RouteContext<'/api/oauth/[provider]/callback'>) {
  const { provider: providerId } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const fail = (message: string) => {
    const url = new URL('/accounts', request.url);
    url.searchParams.set('error', message);
    return NextResponse.redirect(url);
  };

  const provider = getProvider(providerId);
  const state = params.get('state');
  if (!provider || !state) return fail('Invalid connection response.');

  const user = await requireUser();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('oauth_states')
    .select('id, user_id, provider, expires_at, code_verifier')
    .eq('state_hash', createHash('sha256').update(state).digest('hex'))
    .single();

  // State must exist, belong to this user and provider, and be fresh (CSRF protection).
  if (!row || row.user_id !== user.id || row.provider !== provider.id || new Date(row.expires_at) < new Date()) {
    return fail('This connection link has expired. Please try again.');
  }

  if (params.get('error')) {
    await admin.from('oauth_states').delete().eq('id', row.id);
    return fail(params.get('error_description') ?? 'The connection was cancelled.');
  }
  const code = params.get('code');
  if (!code) return fail('Invalid connection response.');

  try {
    const candidates = await provider.connect(code, redirectUriFor(provider.id), row.code_verifier ?? undefined);
    if (!candidates.length) {
      await admin.from('oauth_states').delete().eq('id', row.id);
      return fail(`No ${provider.label} accounts you manage were found for this login.`);
    }
    const { data: secretId, error } = await admin.rpc('store_secret', { p_secret: JSON.stringify(candidates) });
    if (error) throw error;
    await admin
      .from('oauth_states')
      .update({
        secret_id: secretId,
        candidates: candidates.map((c, index) => ({ index, platform: c.platform, name: c.name, avatarUrl: c.avatarUrl, externalId: c.externalId })),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .eq('id', row.id);
    return NextResponse.redirect(new URL(`/accounts/connect/${row.id}`, request.url));
  } catch (e) {
    await admin.from('oauth_states').delete().eq('id', row.id);
    console.error('[oauth] callback failed', provider.id, e);
    return fail(e instanceof ProviderError ? e.message : 'Could not complete the connection.');
  }
}
