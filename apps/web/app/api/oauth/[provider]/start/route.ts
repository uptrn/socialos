import { createHash, randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getProvider, redirectUriFor } from '@/lib/oauth/providers';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

// Starts "Connect account": records a one-time state, then sends the user to the provider.
export async function GET(request: NextRequest, ctx: RouteContext<'/api/oauth/[provider]/start'>) {
  const { provider: providerId } = await ctx.params;
  const accountsUrl = new URL('/accounts', request.url);
  const provider = getProvider(providerId);
  if (!provider) return NextResponse.redirect(accountsUrl);

  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) {
    accountsUrl.searchParams.set('error', 'Only owners and admins can connect accounts.');
    return NextResponse.redirect(accountsUrl);
  }
  if (!provider.configured()) {
    accountsUrl.searchParams.set('error', `${provider.label} is not set up yet (missing app credentials).`);
    return NextResponse.redirect(accountsUrl);
  }

  const state = randomBytes(32).toString('base64url');
  // PKCE: the verifier stays on our server; only its SHA-256 challenge goes to the provider.
  const codeVerifier = provider.pkce ? randomBytes(48).toString('base64url') : null;
  const codeChallenge = codeVerifier ? createHash('sha256').update(codeVerifier).digest('base64url') : undefined;

  const { error } = await createAdminClient().from('oauth_states').insert({
    state_hash: createHash('sha256').update(state).digest('hex'),
    org_id: ws.org.id,
    brand_id: ws.brand.id,
    user_id: ws.userId,
    provider: provider.id,
    code_verifier: codeVerifier,
  });
  if (error) {
    accountsUrl.searchParams.set('error', 'Could not start the connection. Try again.');
    return NextResponse.redirect(accountsUrl);
  }
  return NextResponse.redirect(provider.authorizeUrl(state, redirectUriFor(provider.id), codeChallenge));
}
