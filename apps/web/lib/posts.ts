import 'server-only';
import type { MediaInfo, Platform, PostType, ValidationIssue } from '@socialos/core';
import { validateVariant } from '@socialos/core';
import type { MediaRow } from './media';

export interface VariantRecord {
  id: string;
  social_account_id: string;
  platform: Platform;
  post_type: PostType;
  caption: string;
  thread_parts: string[];
  options: Record<string, unknown>;
  variant_media: { position: number; alt_text: string | null; media_assets: MediaRow }[];
}

export const VARIANT_SELECT =
  'id, social_account_id, platform, post_type, caption, thread_parts, options, variant_media(position, alt_text, media_assets(id, kind, mime_type, size_bytes, width, height, duration_sec, page_count, storage_path, original_name, source))';

export function toMediaInfo(row: MediaRow): MediaInfo {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationSec: row.duration_sec === null ? undefined : Number(row.duration_sec),
    pageCount: row.page_count ?? undefined,
  };
}

export function validateRecord(v: VariantRecord): ValidationIssue[] {
  const media = [...v.variant_media].sort((a, b) => a.position - b.position).map((m) => toMediaInfo(m.media_assets));
  return validateVariant({
    platform: v.platform,
    postType: v.post_type,
    caption: v.caption,
    threadParts: v.thread_parts,
    media,
    options: v.options,
  });
}
