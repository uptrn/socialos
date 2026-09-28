'use server';

import { GRAPHIC_FORMATS, IMAGE_TIERS } from '@socialos/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AiError } from '@/lib/ai/gateway';
import { BillingError, requireFeature } from '@/lib/billing/access';
import { generateBrandImages } from '@/lib/images/generate';
import { downloadStockPhoto, getStockPhoto, pexelsConfigured, searchStockPhotos, type StockPhoto } from '@/lib/images/pexels';
import { saveImageToMedia } from '@/lib/images/save';
import { withSignedUrls } from '@/lib/media-server';
import type { MediaRow } from '@/lib/media';
import { createAdminClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

const formatSchema = z.enum(Object.keys(GRAPHIC_FORMATS) as [keyof typeof GRAPHIC_FORMATS]);

export interface SavedImage {
  id: string;
  url: string | null;
}

async function signed(ids: string[]): Promise<SavedImage[]> {
  const { data } = await createAdminClient()
    .from('media_assets')
    .select('id, kind, mime_type, size_bytes, width, height, duration_sec, page_count, storage_path, original_name')
    .in('id', ids);
  const withUrls = await withSignedUrls((data ?? []) as MediaRow[]);
  return ids.map((id) => ({ id, url: withUrls.find((m) => m.id === id)?.url ?? null }));
}

const generateSchema = z.object({
  brandId: z.string().uuid(),
  description: z.string().trim().min(10, 'Describe the image in a sentence or two.').max(2000),
  tier: z.enum(Object.keys(IMAGE_TIERS) as [keyof typeof IMAGE_TIERS]),
  format: formatSchema,
  count: z.number().int().min(1).max(4),
  allowText: z.boolean(),
});

export async function generateImages(input: z.input<typeof generateSchema>): Promise<{ ok: boolean; images?: SavedImage[]; error?: string }> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const ws = await requireBrandEditor(d.brandId);
  try {
    await requireFeature(ws.org.id, `ai_images_${d.tier}`);
    const ids = await generateBrandImages({ ...d, orgId: ws.org.id, brandName: ws.brand.name, userId: ws.userId });
    revalidatePath('/media');
    return { ok: true, images: await signed(ids) };
  } catch (e) {
    return { ok: false, error: e instanceof AiError || e instanceof BillingError ? e.message : 'Image generation failed.' };
  }
}

export async function searchStock(input: { brandId: string; query: string; orientation?: string; page?: number }): Promise<{ ok: boolean; photos?: StockPhoto[]; total?: number; error?: string }> {
  const parsed = z
    .object({ brandId: z.string().uuid(), query: z.string().trim().min(2, 'Type what you are looking for.').max(100), orientation: z.enum(['landscape', 'portrait', 'square']).optional(), page: z.number().int().min(1).max(50).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const ws = await requireBrandEditor(parsed.data.brandId);
  if (!pexelsConfigured()) return { ok: false, error: 'Stock photos are not set up yet (PEXELS_API_KEY).' };
  try {
    await requireFeature(ws.org.id, 'stock_photos');
    const res = await searchStockPhotos(parsed.data.query, parsed.data.orientation, parsed.data.page);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importStock(input: { brandId: string; photoId: number; format?: string }): Promise<{ ok: boolean; image?: SavedImage; error?: string }> {
  const parsed = z.object({ brandId: z.string().uuid(), photoId: z.number().int().positive(), format: formatSchema.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const ws = await requireBrandEditor(parsed.data.brandId);
  try {
    await requireFeature(ws.org.id, 'stock_photos');
    // Re-fetch by id so the stored attribution comes from Pexels, not the browser.
    const photo = await getStockPhoto(parsed.data.photoId);
    const saved = await saveImageToMedia({
      orgId: ws.org.id,
      brandId: ws.brand.id,
      userId: ws.userId,
      bytes: await downloadStockPhoto(photo),
      format: parsed.data.format,
      source: 'stock',
      name: `Photo by ${photo.photographer} on Pexels.jpg`,
      generation: { provider: 'pexels', photoId: photo.id, pageUrl: photo.pageUrl, photographer: photo.photographer, photographerUrl: photo.photographerUrl },
    });
    revalidatePath('/media');
    const [image] = await signed([saved.id]);
    return { ok: true, image };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
