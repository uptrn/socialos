import type { GraphicFormat } from './graphics-agent';

// AI image generation: tiers, per-provider sizes, and a brand-aware prompt.

export const IMAGE_TIERS = {
  free: { label: 'Free', description: 'Fast drafts (FLUX Schnell via Cloudflare). Square, cropped to your size.' },
  standard: { label: 'Standard', description: 'Google Gemini image. Good quality, good with text.' },
  premium: { label: 'Premium', description: 'OpenAI GPT Image. Best detail and prompt following.' },
} as const;
export type ImageTier = keyof typeof IMAGE_TIERS;

/** Final pixel size we save for each format (matches the Creative studio graphics). */
export const IMAGE_TARGET: Record<GraphicFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 628 },
};

/** Gemini aspect ratios closest to each format. */
export const GEMINI_ASPECT: Record<GraphicFormat, string> = {
  square: '1:1',
  portrait: '4:5',
  story: '9:16',
  landscape: '16:9',
};

/**
 * OpenAI custom sizes: both edges multiples of 16, ratio between 1:3 and 3:1,
 * 655,360-8,294,400 pixels in total.
 */
export const OPENAI_SIZE: Record<GraphicFormat, string> = {
  square: '1024x1024',
  portrait: '1088x1360',
  story: '1088x1920',
  landscape: '1536x800',
};

export interface ImageBrand {
  name: string;
  visualStyle: string;
  primary: string;
  accent: string;
}

/**
 * Adds the brand's visual style and colors to the user's description. Text in images is
 * discouraged unless asked for: models still misspell it, and captions carry the words.
 */
export function buildImagePrompt(description: string, brand: ImageBrand, opts: { allowText?: boolean } = {}): string {
  const parts = [description.trim().replace(/\.?$/, '.')];
  if (brand.visualStyle.trim()) parts.push(`Style: ${brand.visualStyle.trim().replace(/\.?$/, '.')}`);
  parts.push(`Where it fits naturally, use the brand colors ${brand.primary} and ${brand.accent}.`);
  parts.push(opts.allowText ? 'Any text in the image must be spelled exactly as written in this prompt.' : 'Do not include any text, letters, logos or watermarks in the image.');
  parts.push('Suitable for a professional social media post.');
  return parts.join(' ');
}

/** Crop box (centered) that turns a source image into the target aspect ratio. */
export function coverCrop(srcW: number, srcH: number, targetW: number, targetH: number) {
  const targetRatio = targetW / targetH;
  if (srcW / srcH > targetRatio) {
    const width = Math.round(srcH * targetRatio);
    return { left: Math.round((srcW - width) / 2), top: 0, width, height: srcH };
  }
  const height = Math.round(srcW / targetRatio);
  return { left: 0, top: Math.round((srcH - height) / 2), width: srcW, height };
}
