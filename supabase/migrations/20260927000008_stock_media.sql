-- Stock photos (Pexels) are a media source too.
alter table public.media_assets drop constraint media_assets_source_check;
alter table public.media_assets add constraint media_assets_source_check check (source in ('upload','template','ai_image','stock'));
