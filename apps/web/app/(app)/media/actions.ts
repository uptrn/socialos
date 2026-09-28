'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ALLOWED_MEDIA, EXTENSIONS, MAX_UPLOAD_BYTES } from '@/lib/media';
import { createAdminClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

const startSchema = z.object({
  brandId: z.string().uuid(),
  fileName: z.string().max(255),
  mimeType: z.string().refine((m) => m in ALLOWED_MEDIA, 'This file type is not supported'),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'File is larger than 5 GB'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
});

/** Registers the upload and returns a one-time signed URL the browser uploads to directly. */
export async function startUpload(input: z.input<typeof startSchema>) {
  const data = startSchema.parse(input);
  const ws = await requireBrandEditor(data.brandId);
  const admin = createAdminClient();

  const id = crypto.randomUUID();
  const path = `${ws.org.id}/${data.brandId}/${id}.${EXTENSIONS[data.mimeType]}`;

  const { error } = await admin.from('media_assets').insert({
    id,
    org_id: ws.org.id,
    brand_id: data.brandId,
    kind: ALLOWED_MEDIA[data.mimeType],
    mime_type: data.mimeType,
    size_bytes: data.sizeBytes,
    width: data.width ?? null,
    height: data.height ?? null,
    duration_sec: data.durationSec ?? null,
    storage_path: path,
    original_name: data.fileName,
    status: 'uploading',
    created_by: ws.userId,
  });
  if (error) throw new Error(error.message);

  const { data: signed, error: signError } = await admin.storage.from('media').createSignedUploadUrl(path);
  if (signError) throw new Error(signError.message);
  return { id, path, token: signed.token };
}

/** Marks the upload ready once the file is really in storage. */
export async function finishUpload(mediaId: string, brandId: string) {
  const ws = await requireBrandEditor(brandId);
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('media_assets')
    .select('storage_path')
    .eq('id', mediaId)
    .eq('org_id', ws.org.id)
    .single();
  if (!row) throw new Error('Upload not found');

  const { data: exists } = await admin.storage.from('media').exists(row.storage_path);
  const status = exists ? 'ready' : 'failed';
  await admin.from('media_assets').update({ status }).eq('id', mediaId);
  revalidatePath('/media');
  if (!exists) throw new Error('Upload did not complete');
}

export async function deleteMedia(mediaId: string, brandId: string) {
  const ws = await requireBrandEditor(brandId);
  const admin = createAdminClient();
  const { count } = await admin.from('variant_media').select('media_id', { count: 'exact', head: true }).eq('media_id', mediaId);
  if (count) throw new Error('This file is used in a post. Remove it from the post first.');

  const { data: row } = await admin.from('media_assets').select('storage_path').eq('id', mediaId).eq('org_id', ws.org.id).single();
  if (!row) throw new Error('File not found');
  await admin.storage.from('media').remove([row.storage_path]);
  await admin.from('media_assets').update({ status: 'deleted' }).eq('id', mediaId);
  revalidatePath('/media');
}
