import 'server-only';
import { buildImagePrompt, IMAGE_TIERS, type GraphicFormat, type ImageTier } from '@socialos/core';
import { AiError, assertAiBudget, logAgentRun } from '../ai/gateway';
import { createAdminClient } from '../supabase/server';
import { IMAGE_PROVIDERS, ImageProviderError } from './providers';
import { saveImageToMedia } from './save';

/** Generates AI images for a brand and saves them to its media library. Returns media ids. */
export async function generateBrandImages(opts: {
  orgId: string;
  brandId: string;
  brandName: string;
  userId: string;
  description: string;
  tier: ImageTier;
  format: GraphicFormat;
  count: number;
  allowText: boolean;
}): Promise<string[]> {
  const provider = IMAGE_PROVIDERS[opts.tier];
  if (!provider.configured()) throw new AiError(`${IMAGE_TIERS[opts.tier].label} images are not set up yet.`, 'not_configured');
  const count = Math.max(1, Math.min(opts.count, provider.maxCount));

  const db = createAdminClient();
  const { data: look } = await db
    .from('brand_profiles')
    .select('visual_style, color_primary, color_accent')
    .eq('brand_id', opts.brandId)
    .maybeSingle();
  const prompt = buildImagePrompt(
    opts.description,
    { name: opts.brandName, visualStyle: look?.visual_style ?? '', primary: look?.color_primary ?? '#1453F5', accent: look?.color_accent ?? '#0BC3F5' },
    { allowText: opts.allowText },
  );

  const logBase = { orgId: opts.orgId, brandId: opts.brandId, userId: opts.userId, agent: 'image', input: { tier: opts.tier, format: opts.format, count, description: opts.description.slice(0, 500) } };
  await assertAiBudget({ ...logBase, model: opts.tier });

  const started = Date.now();
  try {
    const result = await provider.generate(prompt, opts.format, count);
    const ids: string[] = [];
    for (const [i, bytes] of result.images.entries()) {
      const saved = await saveImageToMedia({
        orgId: opts.orgId,
        brandId: opts.brandId,
        userId: opts.userId,
        bytes,
        format: opts.format,
        source: 'ai_image',
        name: `AI image – ${opts.description.slice(0, 60)}${result.images.length > 1 ? ` (${i + 1})` : ''}.jpg`,
        // ai: true marks the image as AI-generated so it's labeled on platforms that support it.
        generation: { ai: true, tier: opts.tier, model: result.model, prompt },
      });
      ids.push(saved.id);
    }
    await logAgentRun({ ...logBase, model: result.model, status: 'succeeded', output: { mediaIds: ids }, costUsd: result.costUsd, durationMs: Date.now() - started });
    return ids;
  } catch (e) {
    await logAgentRun({ ...logBase, model: opts.tier, status: 'failed', error: (e as Error).message, durationMs: Date.now() - started });
    if (e instanceof ImageProviderError) {
      throw new AiError(e.retryable ? 'The image service is busy. Try again in a minute.' : e.message, 'failed');
    }
    throw new AiError('Image generation failed.', 'failed');
  }
}
