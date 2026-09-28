import 'server-only';
import { hasBlockingIssues } from '@socialos/core';
import { validateRecord, VARIANT_SELECT, type VariantRecord } from './posts';
import { createAdminClient } from './supabase/server';

/** Re-validates what is actually stored for a post against platform rules (callers check permissions). */
export async function storedPostIsValid(postId: string): Promise<boolean> {
  const { data: variants } = await createAdminClient().from('post_variants').select(VARIANT_SELECT).eq('post_id', postId);
  return ((variants ?? []) as unknown as VariantRecord[]).every((v) => !hasBlockingIssues(validateRecord(v)));
}
