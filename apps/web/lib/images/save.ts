import 'server-only';
import { coverCrop, IMAGE_TARGET, type GraphicFormat } from '@socialos/core';
import sharp from 'sharp';
import { createAdminClient } from '../supabase/server';

const MAX_EDGE = 2048;

/**
 * Normalizes an image to JPEG (Instagram only accepts JPEG) and saves it to the brand's
 * media library. With a format, it's center-cropped and resized to that exact size.
 */
export async function saveImageToMedia(opts: {
  orgId: string;
  brandId: string;
  userId: string | null;
  bytes: Buffer;
  format?: GraphicFormat;
  source: 'ai_image' | 'stock';
  name: string;
  generation: Record<string, unknown>;
}): Promise<{ id: string; width: number; height: number }> {
  let image = sharp(opts.bytes).rotate(); // apply EXIF orientation
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable image');

  if (opts.format) {
    const target = IMAGE_TARGET[opts.format];
    image = image.extract(coverCrop(meta.width, meta.height, target.width, target.height)).resize(target.width, target.height);
  } else {
    image = image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  }
  const { data: jpeg, info } = await image.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const path = `${opts.orgId}/${opts.brandId}/${id}.jpg`;
  const { error: uploadError } = await admin.storage.from('media').upload(path, jpeg, { contentType: 'image/jpeg' });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { error } = await admin.from('media_assets').insert({
    id,
    org_id: opts.orgId,
    brand_id: opts.brandId,
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: jpeg.length,
    width: info.width,
    height: info.height,
    storage_path: path,
    original_name: opts.name.slice(0, 200),
    status: 'ready',
    source: opts.source,
    generation: opts.generation,
    created_by: opts.userId,
  });
  if (error) throw new Error(error.message);
  return { id, width: info.width, height: info.height };
}
