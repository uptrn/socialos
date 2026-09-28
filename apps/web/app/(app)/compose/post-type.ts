import { getSpec, type MediaInfo, type Platform, type PostType } from '@socialos/core';

/** Best default post type for a platform given the attached media. The user can override it. */
export function inferPostType(platform: Platform, media: MediaInfo[]): PostType {
  const supported = Object.keys(getSpec(platform).postTypes) as PostType[];
  const pick = (...candidates: PostType[]) => candidates.find((c) => supported.includes(c)) ?? supported[0]!;

  if (media.length === 0) return pick('text');
  const first = media[0]!;
  if (first.kind === 'document') return pick('document');
  if (media.length > 1) return pick('carousel', 'image');
  if (first.kind === 'image') return pick('image', 'carousel');

  // single video
  const vertical = first.width && first.height ? first.height >= first.width : false;
  if (platform === 'youtube') return vertical && (first.durationSec ?? 0) <= 180 ? 'short' : 'video';
  if (platform === 'instagram') return 'reel';
  return pick('video', 'reel');
}

export const POST_TYPE_LABELS: Record<PostType, string> = {
  text: 'Text',
  image: 'Image',
  carousel: 'Carousel',
  video: 'Video',
  reel: 'Reel',
  story: 'Story',
  short: 'Short',
  document: 'Document (PDF)',
};
