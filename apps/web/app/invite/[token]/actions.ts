'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { hashInviteToken } from '@/lib/team';
import { BRAND_COOKIE, ORG_COOKIE, requireUser } from '@/lib/workspace';

// Bound to the token; used with useActionState (previous state is not needed).
export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const { data: orgId, error } = await createAdminClient().rpc('accept_org_invitation', {
    p_token_hash: hashInviteToken(token),
    p_user: user.id,
  });
  if (error) return { error: error.message };

  // Open the organization they just joined.
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId as string, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  jar.delete(BRAND_COOKIE);
  redirect('/calendar');
}
