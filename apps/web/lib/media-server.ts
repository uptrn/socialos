import 'server-only';
import type { MediaRow } from './media';
import { createAdminClient, createUserClient } from './supabase/server';

export interface MediaWithUrl extends MediaRow {
  url: string | null;
}

/** Ready media for a brand with short-lived signed URLs for previews. */
export async function listBrandMedia(brandId: string, limit = 200): Promise<MediaWithUrl[]> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('media_assets')
    .select('id, kind, mime_type, size_bytes, width, height, duration_sec, page_count, storage_path, original_name, source')
    .eq('brand_id', brandId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as MediaRow[];
  return withSignedUrls(rows);
}

export async function withSignedUrls(rows: MediaRow[], expiresInSec = 3600): Promise<MediaWithUrl[]> {
  if (!rows.length) return [];
  const admin = createAdminClient();
  const { data } = await admin.storage.from('media').createSignedUrls(rows.map((r) => r.storage_path), expiresInSec);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({ ...r, url: byPath.get(r.storage_path) ?? null }));
}
