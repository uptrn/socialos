import { z } from 'zod';
import type { Platform } from './types';

// Per-platform options a user can set on a post variant, beyond caption + media.

export const instagramOptions = z.object({
  firstComment: z.string().max(2200).optional(),
  locationId: z.string().optional(),
  collaborators: z.array(z.string()).max(3).optional(),
  shareReelToFeed: z.boolean().default(true),
  coverMediaId: z.string().optional(),
  thumbOffsetMs: z.number().int().nonnegative().optional(),
  altText: z.string().max(1000).optional(),
});

export const facebookOptions = z.object({
  link: z.string().url().optional(),
  firstComment: z.string().max(8000).optional(),
  videoTitle: z.string().max(255).optional(),
});

export const threadsOptions = z.object({
  replyControl: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only']).default('everyone'),
});

export const linkedinOptions = z.object({
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).default('PUBLIC'),
  documentTitle: z.string().max(400).optional(),
  altText: z.string().max(4086).optional(),
});

export const xOptions = z.object({
  replySettings: z.enum(['everyone', 'following', 'mentionedUsers']).default('everyone'),
  altText: z.string().max(1000).optional(),
});

export const tiktokOptions = z.object({
  // Must be one of the levels the creator's account allows (queried at publish time).
  privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']),
  disableComment: z.boolean().default(false),
  disableDuet: z.boolean().default(false),
  disableStitch: z.boolean().default(false),
  coverTimestampMs: z.number().int().nonnegative().optional(),
  brandContent: z.boolean().default(false),
  brandOrganic: z.boolean().default(false),
});

export const youtubeOptions = z.object({
  title: z.string().min(1).max(100),
  tags: z.array(z.string()).default([]),
  privacyStatus: z.enum(['public', 'unlisted', 'private']).default('public'),
  categoryId: z.string().default('22'),
  madeForKids: z.boolean(),
  thumbnailMediaId: z.string().optional(),
});

export const PLATFORM_OPTIONS = {
  instagram: instagramOptions,
  facebook: facebookOptions,
  threads: threadsOptions,
  linkedin: linkedinOptions,
  x: xOptions,
  tiktok: tiktokOptions,
  youtube: youtubeOptions,
} satisfies Record<Platform, z.ZodTypeAny>;

export type PlatformOptions = {
  [P in Platform]: z.infer<(typeof PLATFORM_OPTIONS)[P]>;
};
