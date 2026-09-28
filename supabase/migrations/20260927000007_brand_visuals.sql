-- Brand visuals used by the Creative agent's templates and image prompts.

alter table public.brand_profiles
  add column color_primary    text not null default '#1453F5' check (color_primary ~ '^#[0-9A-Fa-f]{6}$'),
  add column color_accent     text not null default '#0BC3F5' check (color_accent ~ '^#[0-9A-Fa-f]{6}$'),
  add column color_background text not null default '#FFFFFF' check (color_background ~ '^#[0-9A-Fa-f]{6}$'),
  add column color_text       text not null default '#0B1A3E' check (color_text ~ '^#[0-9A-Fa-f]{6}$'),
  add column logo_media_id    uuid references public.media_assets(id) on delete set null,
  add column visual_style     text not null default ''; -- words for AI image prompts, e.g. "bright, flat illustration"

-- Where a media file came from, so generated graphics are easy to find and reuse.
alter table public.media_assets
  add column source text not null default 'upload' check (source in ('upload','template','ai_image')),
  add column generation jsonb; -- template id + slide copy, or image prompt + model
