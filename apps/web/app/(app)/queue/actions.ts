'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

export async function retryJob(jobId: string, brandId: string) {
  const ws = await requireBrandEditor(brandId);
  const admin = createAdminClient();
  const { data: job } = await admin.from('publish_jobs').select('id').eq('id', jobId).eq('brand_id', brandId).eq('org_id', ws.org.id).single();
  if (!job) throw new Error('Job not found');
  const { error } = await admin.rpc('retry_publish_job', { p_job: jobId, p_actor: ws.userId });
  if (error) throw new Error(error.message);
  revalidatePath('/queue');
}
