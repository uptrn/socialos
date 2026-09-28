'use server';

import { revalidatePath } from 'next/cache';
import { newServerKey } from '@/lib/conversions';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

async function requireBrandAdmin(brandId: string) {
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) throw new Error('Only owners and admins can change tracking.');
  if (!ws.brands.some((b) => b.id === brandId)) throw new Error('Brand not found.');
  return ws;
}

export async function setLinkTracking(brandId: string, enabled: boolean): Promise<{ error?: string }> {
  try {
    const ws = await requireBrandAdmin(brandId);
    const { error } = await createAdminClient().from('brands').update({ link_tracking: enabled === true }).eq('id', brandId).eq('org_id', ws.org.id);
    if (error) return { error: error.message };
    revalidatePath('/settings/tracking');
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Creates (or replaces) the brand's server key. The key is shown once; only its hash is kept. */
export async function createServerKey(brandId: string): Promise<{ error?: string; key?: string }> {
  try {
    const ws = await requireBrandAdmin(brandId);
    const { key, hash } = newServerKey();
    const db = createAdminClient();
    const { error } = await db.from('brands').update({ tracking_secret_hash: hash }).eq('id', brandId).eq('org_id', ws.org.id);
    if (error) return { error: error.message };
    await db.from('audit_logs').insert({
      org_id: ws.org.id, brand_id: brandId, actor_type: 'user', actor_id: ws.userId,
      action: 'brand.conversion_key_created', resource_type: 'brand', resource_id: brandId,
    });
    revalidatePath('/settings/tracking');
    return { key };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
