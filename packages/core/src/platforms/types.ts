export const PLATFORMS = [
  'facebook',
  'instagram',
  'threads',
  'linkedin',
  'x',
  'tiktok',
  'youtube',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_TYPES = [
  'text',
  'image',
  'carousel',
  'video',
  'reel',
  'story',
  'short',
  'document',
] as const;
export type PostType = (typeof POST_TYPES)[number];

export type MediaKind = 'image' | 'video' | 'document';

/** Metadata we extract on upload; the file itself lives in storage. */
export interface MediaInfo {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  pageCount?: number;
}

export interface ImageRules {
  formats: string[]; // mime types
  maxSizeMB: number;
  /** width / height */
  minAspect?: number;
  maxAspect?: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface VideoRules {
  formats: string[];
  maxSizeMB: number;
  minDurationSec: number;
  maxDurationSec: number;
  minAspect?: number;
  maxAspect?: number;
}

export interface DocumentRules {
  formats: string[];
  maxSizeMB: number;
  maxPages?: number;
}

export interface PostTypeSpec {
  /** Allowed media kinds for items in this post type. Empty = text only. */
  mediaKinds: MediaKind[];
  minMedia: number;
  maxMedia: number;
  image?: ImageRules;
  video?: VideoRules;
  document?: DocumentRules;
  /** Overrides the platform caption limit for this post type. */
  captionMaxLength?: number;
  /** Caption is not shown/allowed for this type (e.g. stories). */
  captionSupported?: boolean;
  notes?: string;
}

export interface PlatformSpec {
  platform: Platform;
  label: string;
  captionMaxLength: number;
  maxHashtags?: number;
  maxMentions?: number;
  /** Count URLs as a fixed length (X counts every URL as 23 chars). */
  urlWeight?: number;
  /** Supports a chain of posts (X threads, Threads replies). */
  supportsThread?: boolean;
  maxThreadParts?: number;
  postTypes: Partial<Record<PostType, PostTypeSpec>>;
  /**
   * Limits in this file are taken from platform documentation as understood at
   * time of writing and MUST be re-verified in Phase 0 before production use.
   */
  verified: boolean;
  /** Date (YYYY-MM-DD) the limits were last checked against docsUrl. */
  verifiedAt?: string;
  docsUrl: string;
}
