import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logoDataUrl, type BrandLook } from './render';

interface LookRow {
  color_primary: string;
  color_accent: string;
  color_background: string;
  color_text: string;
  logo_media_id: string | null;
  website: string | null;
}

const DEFAULT_LOOK = { color_primary: '#1453F5', color_accent: '#0BC3F5', color_background: '#FFFFFF', color_text: '#0B1A3E', logo_media_id: null, website: null };

/** The brand's colors, logo and website for rendering graphics. */
export async function loadBrandLook(db: SupabaseClient, brandId: string, brandName: string): Promise<BrandLook> {
  const { data } = await db
    .from('brand_profiles')
    .select('color_primary, color_accent, color_background, color_text, logo_media_id, website')
    .eq('brand_id', brandId)
    .maybeSingle();
  const row: LookRow = data ?? DEFAULT_LOOK;

  let logo: string | undefined;
  if (row.logo_media_id) {
    const { data: media } = await db.from('media_assets').select('storage_path').eq('id', row.logo_media_id).eq('brand_id', brandId).maybeSingle();
    if (media) {
      const { data: file } = await db.storage.from('media').download(media.storage_path);
      if (file) logo = await logoDataUrl(await file.arrayBuffer()).catch(() => undefined);
    }
  }

  return {
    name: brandName,
    primary: row.color_primary,
    accent: row.color_accent,
    background: row.color_background,
    text: row.color_text,
    logoDataUrl: logo,
    website: row.website,
  };
}
