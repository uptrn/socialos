'use server';

import {
  GRAPHIC_FORMATS,
  GRAPHIC_TEMPLATES,
  finalizeSlides,
  graphicsOutputSchema,
  graphicsSystemPrompt,
  graphicsUserPrompt,
  slideIssues,
  type Slide,
} from '@socialos/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AiError, runAgent } from '@/lib/ai/gateway';
import { BillingError, requireFeature } from '@/lib/billing/access';
import { loadBrandProfileRow, toBrandProfile } from '@/lib/brand-profile';
import { loadBrandLook } from '@/lib/creative/look';
import { renderSlideJpeg } from '@/lib/creative/render';
import { createAdminClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

const templateSchema = z.enum(Object.keys(GRAPHIC_TEMPLATES) as [keyof typeof GRAPHIC_TEMPLATES]);
const formatSchema = z.enum(Object.keys(GRAPHIC_FORMATS) as [keyof typeof GRAPHIC_FORMATS]);
const slideSchema = z.object({
  layout: z.enum(['cover', 'point', 'cta', 'quote', 'announcement', 'stat']),
  eyebrow: z.string().max(120),
  title: z.string().max(200),
  body: z.string().max(600),
  footnote: z.string().max(200),
});
const slidesSchema = z.array(slideSchema).min(1).max(10);

export async function writeSlides(input: { brandId: string; template: string; brief: string; slideCount?: number }): Promise<{ ok: boolean; slides?: Slide[]; error?: string }> {
  const parsed = z
    .object({ brandId: z.string().uuid(), template: templateSchema, brief: z.string().trim().min(5, 'Describe the graphic first.').max(3000), slideCount: z.number().int().min(3).max(10).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const { brandId, template, brief, slideCount } = parsed.data;
  const ws = await requireBrandEditor(brandId);
  const profile = toBrandProfile(ws.brand.name, await loadBrandProfileRow(brandId));

  try {
    await requireFeature(ws.org.id, 'graphics');
    const output = await runAgent({
      agent: 'graphics',
      orgId: ws.org.id,
      brandId,
      userId: ws.userId,
      system: graphicsSystemPrompt(profile),
      user: graphicsUserPrompt(template, brief, slideCount),
      schema: graphicsOutputSchema,
      effort: 'low',
      logInput: { template, brief: brief.slice(0, 500), slideCount },
    });
    return { ok: true, slides: finalizeSlides(template, output.slides) };
  } catch (e) {
    return { ok: false, error: e instanceof AiError || e instanceof BillingError ? e.message : 'Could not write the slides.' };
  }
}

/** Renders slides for preview; returns JPEG data URLs. */
export async function previewSlides(input: { brandId: string; format: string; slides: Slide[] }): Promise<{ ok: boolean; images?: string[]; warnings?: string[][]; error?: string }> {
  const parsed = z.object({ brandId: z.string().uuid(), format: formatSchema, slides: slidesSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const ws = await requireBrandEditor(parsed.data.brandId);
  const look = await loadBrandLook(createAdminClient(), ws.brand.id, ws.brand.name);
  const images = await Promise.all(parsed.data.slides.map(async (s) => `data:image/jpeg;base64,${(await renderSlideJpeg(s, look, parsed.data.format)).toString('base64')}`));
  return { ok: true, images, warnings: parsed.data.slides.map(slideIssues) };
}

/** Renders the slides and saves each one to the media library. Returns the new media ids in order. */
export async function saveSlides(input: { brandId: string; template: string; format: string; slides: Slide[] }): Promise<{ ok: boolean; mediaIds?: string[]; error?: string }> {
  const parsed = z.object({ brandId: z.string().uuid(), template: templateSchema, format: formatSchema, slides: slidesSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const { brandId, template, format, slides } = parsed.data;
  const ws = await requireBrandEditor(brandId);
  try {
    await requireFeature(ws.org.id, 'graphics');
  } catch (e) {
    if (e instanceof BillingError) return { ok: false, error: e.message };
    throw e;
  }
  const admin = createAdminClient();
  const look = await loadBrandLook(admin, brandId, ws.brand.name);
  const { width, height } = GRAPHIC_FORMATS[format];
  const batch = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const ids: string[] = [];
  for (const [i, slide] of slides.entries()) {
    const jpeg = await renderSlideJpeg(slide, look, format);
    const id = crypto.randomUUID();
    const path = `${ws.org.id}/${brandId}/${id}.jpg`;
    const { error: uploadError } = await admin.storage.from('media').upload(path, jpeg, { contentType: 'image/jpeg' });
    if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };
    const { error } = await admin.from('media_assets').insert({
      id,
      org_id: ws.org.id,
      brand_id: brandId,
      kind: 'image',
      mime_type: 'image/jpeg',
      size_bytes: jpeg.length,
      width,
      height,
      storage_path: path,
      original_name: `${GRAPHIC_TEMPLATES[template].label} ${batch} (${i + 1}-${slides.length}).jpg`,
      status: 'ready',
      source: 'template',
      generation: { template, format, slide },
      created_by: ws.userId,
    });
    if (error) return { ok: false, error: error.message };
    ids.push(id);
  }
  revalidatePath('/media');
  return { ok: true, mediaIds: ids };
}
