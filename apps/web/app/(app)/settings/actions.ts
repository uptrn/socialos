'use server';

import { isValidTimeZone } from '@socialos/core';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BillingError, requireCapacity } from '@/lib/billing/access';
import { createAdminClient } from '@/lib/supabase/server';
import { BRAND_COOKIE, getWorkspace } from '@/lib/workspace';

const brandSchema = z.object({
  name: z.string().trim().min(2, 'Enter the brand name').max(120),
  timezone: z.string().refine(isValidTimeZone, 'Choose a valid timezone'),
});

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'brand';
}

/** Turns "posts need approval" on or off for a brand (owners and admins). */
export async function setBrandApproval(brandId: string, required: boolean): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) return { error: 'Only owners and admins can change this.' };
  if (!ws.brands.some((b) => b.id === brandId)) return { error: 'Brand not found.' };
  const { error } = await createAdminClient().from('brands').update({ require_approval: required === true }).eq('id', brandId).eq('org_id', ws.org.id);
  if (error) return { error: error.message };
  await createAdminClient().from('audit_logs').insert({
    org_id: ws.org.id, brand_id: brandId, actor_type: 'user', actor_id: ws.userId,
    action: required ? 'brand.approval_required' : 'brand.approval_not_required', resource_type: 'brand', resource_id: brandId,
  });
  revalidatePath('/', 'layout');
  return {};
}

/** Adds a brand to the organization (within the plan's brand limit) and switches to it. */
export async function addBrand(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const parsed = brandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) return { error: 'Only owners and admins can add brands.' };
  try {
    await requireCapacity(ws.org.id, 'brands');
  } catch (e) {
    if (e instanceof BillingError) return { error: e.message };
    throw e;
  }

  const { data, error } = await createAdminClient()
    .from('brands')
    .insert({
      org_id: ws.org.id,
      name: parsed.data.name,
      slug: `${slugify(parsed.data.name)}-${Math.random().toString(36).slice(2, 7)}`,
      timezone: parsed.data.timezone,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };

  (await cookies()).set(BRAND_COOKIE, data.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
  return {};
}
