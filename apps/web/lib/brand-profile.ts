import 'server-only';
import type { BrandProfile } from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from './supabase/server';

export interface BrandProfileRow {
  website: string | null;
  description: string;
  audience: string;
  products: string;
  voice: string;
  words_to_use: string[];
  words_to_avoid: string[];
  approved_claims: string[];
  banned_claims: string[];
  default_hashtags: string[];
  primary_cta: string;
  example_posts: string;
  research_keywords: string[];
  competitors: string[];
  research_weekly: boolean;
  color_primary: string;
  color_accent: string;
  color_background: string;
  color_text: string;
  logo_media_id: string | null;
  visual_style: string;
}

export const EMPTY_PROFILE: BrandProfileRow = {
  website: null,
  description: '',
  audience: '',
  products: '',
  voice: '',
  words_to_use: [],
  words_to_avoid: [],
  approved_claims: [],
  banned_claims: [],
  default_hashtags: [],
  primary_cta: '',
  example_posts: '',
  research_keywords: [],
  competitors: [],
  research_weekly: false,
  color_primary: '#1453F5',
  color_accent: '#0BC3F5',
  color_background: '#FFFFFF',
  color_text: '#0B1A3E',
  logo_media_id: null,
  visual_style: '',
};

/** Loads as the signed-in user unless a (service) client is passed, e.g. from a cron job. */
export async function loadBrandProfileRow(brandId: string, db?: SupabaseClient): Promise<BrandProfileRow> {
  const supabase = db ?? (await createUserClient());
  const { data } = await supabase.from('brand_profiles').select('*').eq('brand_id', brandId).maybeSingle();
  return data ? (data as BrandProfileRow) : EMPTY_PROFILE;
}

export function toBrandProfile(brandName: string, row: BrandProfileRow): BrandProfile {
  return {
    brandName,
    website: row.website,
    description: row.description,
    audience: row.audience,
    products: row.products,
    voice: row.voice,
    wordsToUse: row.words_to_use,
    wordsToAvoid: row.words_to_avoid,
    approvedClaims: row.approved_claims,
    bannedClaims: row.banned_claims,
    defaultHashtags: row.default_hashtags,
    primaryCta: row.primary_cta,
    examplePosts: row.example_posts,
  };
}
