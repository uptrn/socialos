import 'server-only';
import { GEMINI_ASPECT, OPENAI_SIZE, type GraphicFormat, type ImageTier } from '@socialos/core';

// Image generation providers, one per tier. Each returns raw image bytes; the caller
// crops/resizes to the exact target size and saves JPEG. Docs checked 2026-09-27:
//   Cloudflare: developers.cloudflare.com/workers-ai/models/flux-1-schnell/ (+ /get-started/rest-api/)
//   Gemini:     ai.google.dev/gemini-api/docs/image-generation, /pricing
//   OpenAI:     developers.openai.com/api/docs/guides/image-generation

export class ImageProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

export interface GeneratedImages {
  images: Buffer[];
  model: string;
  /** Best estimate in USD; see each provider for its basis. */
  costUsd: number;
}

export interface ImageProvider {
  tier: ImageTier;
  configured(): boolean;
  /** Max images per request we allow for this tier. */
  maxCount: number;
  generate(prompt: string, format: GraphicFormat, count: number): Promise<GeneratedImages>;
}

async function failure(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => '');
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text);
    message = body?.error?.message ?? body?.errors?.[0]?.message ?? body?.message ?? message;
  } catch {
    // not JSON
  }
  throw new ImageProviderError(`${what} failed (${res.status}): ${message}`, res.status === 429 || res.status >= 500);
}

// --- Free: FLUX.1 [schnell] on Cloudflare Workers AI (Apache 2.0; free daily allocation) ----------

const cloudflare: ImageProvider = {
  tier: 'free',
  maxCount: 4,
  configured: () => !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
  async generate(prompt, _format, count) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const images: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      // The model takes no size; it returns a square JPEG that we crop to the format.
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 8, seed: Math.floor(Math.random() * 2 ** 31) }),
      });
      if (!res.ok) await failure(res, 'Cloudflare image');
      const body = (await res.json()) as { success: boolean; result?: { image?: string }; errors?: { message: string }[] };
      if (!body.success || !body.result?.image) throw new ImageProviderError(`Cloudflare image failed: ${body.errors?.[0]?.message ?? 'no image returned'}`);
      images.push(Buffer.from(body.result.image, 'base64'));
    }
    // Within the free daily allocation this costs nothing; beyond it, a fraction of a cent.
    return { images, model: 'flux-1-schnell', costUsd: 0 };
  },
};

// --- Standard: Google Gemini image (Nano Banana 2) --------------------------------------------------

/** Finds the first base64 image anywhere in a response (the response shape has been changing). */
function findImage(value: unknown): { data: string; mime: string } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const mime = (v.mime_type ?? v.mimeType) as string | undefined;
  if (typeof v.data === 'string' && mime?.startsWith('image/')) return { data: v.data, mime };
  for (const child of Object.values(v)) {
    const found = Array.isArray(child) ? child.map(findImage).find(Boolean) : findImage(child);
    if (found) return found;
  }
  return null;
}

const GEMINI_USD_PER_1K_IMAGE = 0.067; // gemini-3.1-flash-image, 1K, per ai.google.dev pricing (2026-09-27)

const gemini: ImageProvider = {
  tier: 'standard',
  maxCount: 2,
  configured: () => !!process.env.GEMINI_API_KEY,
  async generate(prompt, format, count) {
    const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
    const images: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [{ type: 'text', text: prompt }],
          response_format: { type: 'image', aspect_ratio: GEMINI_ASPECT[format], image_size: '1K' },
        }),
      });
      if (!res.ok) await failure(res, 'Gemini image');
      const image = findImage(await res.json());
      if (!image) throw new ImageProviderError('Gemini returned no image (the prompt may have been blocked).');
      images.push(Buffer.from(image.data, 'base64'));
    }
    return { images, model, costUsd: GEMINI_USD_PER_1K_IMAGE * images.length };
  },
};

// --- Premium: OpenAI GPT Image -----------------------------------------------------------------------

const openai: ImageProvider = {
  tier: 'premium',
  maxCount: 2,
  configured: () => !!process.env.OPENAI_API_KEY,
  async generate(prompt, format, count) {
    const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-flare';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        size: OPENAI_SIZE[format],
        quality: process.env.OPENAI_IMAGE_QUALITY ?? 'medium',
        output_format: 'jpeg',
        output_compression: 90,
        n: count,
      }),
    });
    if (!res.ok) await failure(res, 'OpenAI image');
    const body = (await res.json()) as { data?: { b64_json?: string }[] };
    const images = (body.data ?? []).map((d) => d.b64_json).filter((b): b is string => !!b).map((b) => Buffer.from(b, 'base64'));
    if (!images.length) throw new ImageProviderError('OpenAI returned no image.');
    // Price depends on model, size and quality; OPENAI_IMAGE_USD lets you set the current rate.
    return { images, model, costUsd: Number(process.env.OPENAI_IMAGE_USD ?? 0.05) * images.length };
  },
};

export const IMAGE_PROVIDERS: Record<ImageTier, ImageProvider> = { free: cloudflare, standard: gemini, premium: openai };

export function availableTiers(): ImageTier[] {
  return (Object.keys(IMAGE_PROVIDERS) as ImageTier[]).filter((t) => IMAGE_PROVIDERS[t].configured());
}
