'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { escapeHtml, sendEmail } from '@/lib/notify';
import { createAdminClient } from '@/lib/supabase/server';
import { INVITABLE_ROLES, inviteUrl, newInviteToken, ROLE_INFO } from '@/lib/team';
import { getWorkspace } from '@/lib/workspace';

export interface InviteState {
  error?: string;
  /** The invitation link, shown so it can be shared if email isn't set up. */
  link?: string;
  email?: string;
  emailed?: boolean;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(320),
  role: z.enum(INVITABLE_ROLES),
});

// Permissions are enforced in the database functions (actor = the signed-in user).

async function issueInvite(email: string, role: (typeof INVITABLE_ROLES)[number]): Promise<InviteState> {
  const ws = await getWorkspace();
  const { token, hash } = newInviteToken();
  const { error } = await createAdminClient().rpc('create_org_invitation', {
    p_org: ws.org.id,
    p_email: email,
    p_role: role,
    p_token_hash: hash,
    p_actor: ws.userId,
  });
  if (error) return { error: error.message };

  const link = inviteUrl(token);
  await sendEmail({
    to: [email],
    subject: `You're invited to ${ws.org.name} on SocialOS`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0b1a3e">
      <h2 style="margin:0 0 12px">Join ${escapeHtml(ws.org.name)} on SocialOS</h2>
      <p>${escapeHtml(ws.email ?? 'A teammate')} invited you as <b>${ROLE_INFO[role].label}</b>: ${escapeHtml(ROLE_INFO[role].description)}</p>
      <p><a href="${link}" style="display:inline-block;background:#1453f5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Accept invitation</a></p>
      <p style="color:#5b6788;font-size:12px">The link works for 7 days and only for ${escapeHtml(email)}. If you weren't expecting this, ignore this email.</p>
    </div>`,
    idempotencyKey: `invite:${hash}`,
  });
  revalidatePath('/team');
  return { link, email, emailed: !!process.env.RESEND_API_KEY };
}

export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  return issueInvite(parsed.data.email, parsed.data.role);
}

/** Sends a fresh link (the old one stops working) and restarts the 7 days. */
export async function resendInvite(invitationId: string): Promise<InviteState> {
  const ws = await getWorkspace();
  const { data: inv } = await createAdminClient()
    .from('org_invitations')
    .select('email, role')
    .eq('id', invitationId)
    .eq('org_id', ws.org.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();
  if (!inv) return { error: 'Invitation not found.' };
  return issueInvite(inv.email, inv.role as (typeof INVITABLE_ROLES)[number]);
}

export async function revokeInvite(invitationId: string): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  const { error } = await createAdminClient().rpc('revoke_org_invitation', { p_invitation: invitationId, p_actor: ws.userId });
  revalidatePath('/team');
  return error ? { error: error.message } : {};
}

const roleSchema = z.enum(['owner', 'admin', 'manager', 'reviewer', 'viewer']);

export async function changeRole(userId: string, role: string): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return { error: 'Invalid role.' };
  const { error } = await createAdminClient().rpc('update_org_member', { p_org: ws.org.id, p_user: userId, p_role: parsed.data, p_actor: ws.userId });
  revalidatePath('/team');
  return error ? { error: error.message } : {};
}

/** Removes a member, or leaves the organization when userId is the signed-in user. */
export async function removeMember(userId: string): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  const { error } = await createAdminClient().rpc('update_org_member', { p_org: ws.org.id, p_user: userId, p_role: null, p_actor: ws.userId });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return {};
}
