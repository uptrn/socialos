'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createUserClient } from '@/lib/supabase/server';
import { requireBrandEditor } from '@/lib/workspace';

const lines = (max: number) =>
  z
    .string()
    .max(20000)
    .transform((s) =>
      s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, max),
    );

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colors must be like #1453F5');

const schema = z.object({
  brandId: z.string().uuid(),
  website: z.union([z.literal(''), z.string().url('Enter a full website address, e.g. https://example.com')]),
  description: z.string().max(4000),
  audience: z.string().max(4000),
  products: z.string().max(8000),
  voice: z.string().max(4000),
  wordsToUse: lines(100),
  wordsToAvoid: lines(100),
  approvedClaims: lines(200),
  bannedClaims: lines(200),
  defaultHashtags: lines(50).transform((tags) => tags.map((t) => t.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean)),
  primaryCta: z.string().max(300),
  examplePosts: z.string().max(12000),
  researchKeywords: lines(50),
  competitors: lines(30),
  researchWeekly: z.string().optional().transform((v) => v === 'on'),
  colorPrimary: hex,
  colorAccent: hex,
  colorBackground: hex,
  colorText: hex,
  logoMediaId: z.union([z.literal(''), z.string().uuid()]),
  visualStyle: z.string().max(1000),
});

export async function saveBrandProfile(_prev: { error?: string; saved?: boolean }, formData: FormData): Promise<{ error?: string; saved?: boolean }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const ws = await requireBrandEditor(d.brandId);

  const supabase = await createUserClient();
  const { error } = await supabase.from('brand_profiles').upsert({
    brand_id: d.brandId,
    org_id: ws.org.id,
    website: d.website || null,
    description: d.description,
    audience: d.audience,
    products: d.products,
    voice: d.voice,
    words_to_use: d.wordsToUse,
    words_to_avoid: d.wordsToAvoid,
    approved_claims: d.approvedClaims,
    banned_claims: d.bannedClaims,
    default_hashtags: d.defaultHashtags,
    primary_cta: d.primaryCta,
    example_posts: d.examplePosts,
    research_keywords: d.researchKeywords,
    competitors: d.competitors,
    research_weekly: d.researchWeekly,
    color_primary: d.colorPrimary,
    color_accent: d.colorAccent,
    color_background: d.colorBackground,
    color_text: d.colorText,
    logo_media_id: d.logoMediaId || null,
    visual_style: d.visualStyle,
    updated_by: ws.userId,
  });
  if (error) return { error: error.message };
  revalidatePath('/brand');
  return { saved: true };
}
