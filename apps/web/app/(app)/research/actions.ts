'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AiError } from '@/lib/ai/gateway';
import { BillingError, requireFeature } from '@/lib/billing/access';
import { runBrandResearch } from '@/lib/research';
import { createUserClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

export async function runResearchNow(brandId: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const ws = await requireBrandEditor(brandId);
  try {
    await requireFeature(ws.org.id, 'research');
    const count = await runBrandResearch({ orgId: ws.org.id, brandId, brandName: ws.brand.name, userId: ws.userId });
    revalidatePath('/research');
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof AiError || e instanceof BillingError ? e.message : 'Research failed. Please try again.' };
  }
}

const statusSchema = z.enum(['new', 'saved', 'dismissed']);

export async function setResearchStatus(itemId: string, brandId: string, status: z.input<typeof statusSchema>) {
  await requireBrandEditor(brandId);
  const supabase = await createUserClient();
  const { error } = await supabase.from('research_items').update({ status: statusSchema.parse(status) }).eq('id', itemId).eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  revalidatePath('/research');
}

/** Marks the idea as used and opens the composer with it as the AI brief. */
export async function createPostFromIdea(itemId: string, brandId: string) {
  await requireBrandEditor(brandId);
  const supabase = await createUserClient();
  await supabase.from('research_items').update({ status: 'used' }).eq('id', itemId).eq('brand_id', brandId);
  redirect(`/compose?idea=${itemId}`);
}
