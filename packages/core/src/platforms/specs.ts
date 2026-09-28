import type { ImageRules, Platform, PlatformSpec, VideoRules } from './types';

// Platforms with `verified: false` use limits as understood when written; they change
// often. Re-check each against its docsUrl before enabling the platform in production,
// then set `verified: true` and `verifiedAt`.

const JPEG_PNG = ['image/jpeg', 'image/png'];
const MP4_MOV = ['video/mp4', 'video/quicktime'];

// Instagram: verified 2026-09-26 against
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
const igImage: ImageRules = { formats: ['image/jpeg'], maxSizeMB: 8, minAspect: 4 / 5, maxAspect: 1.91, minWidth: 320, maxWidth: 1440 };
const igStoryImage: ImageRules = { formats: ['image/jpeg'], maxSizeMB: 8 };
const igReel: VideoRules = { formats: MP4_MOV, maxSizeMB: 300, minDurationSec: 3, maxDurationSec: 900, minAspect: 0.01, maxAspect: 10 };
const igStoryVideo: VideoRules = { formats: MP4_MOV, maxSizeMB: 100, minDurationSec: 3, maxDurationSec: 60, minAspect: 0.1, maxAspect: 10 };

const threadsImage: ImageRules = { formats: JPEG_PNG, maxSizeMB: 8, minWidth: 320, maxWidth: 1440, minAspect: 0.1, maxAspect: 10 };
const threadsVideo: VideoRules = { formats: MP4_MOV, maxSizeMB: 1000, minDurationSec: 1, maxDurationSec: 300, maxAspect: 10 };

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    captionMaxLength: 2200,
    maxHashtags: 30,
    maxMentions: 20,
    verified: true,
    verifiedAt: '2026-09-26',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
    postTypes: {
      image: { mediaKinds: ['image'], minMedia: 1, maxMedia: 1, image: igImage },
      carousel: {
        mediaKinds: ['image', 'video'],
        minMedia: 2,
        maxMedia: 10,
        image: igImage,
        // Carousel video limits aren't listed separately; we use the reel limits.
        video: igReel,
        notes: 'Counts as one post toward the 100 API posts per 24 hours limit.',
      },
      reel: { mediaKinds: ['video'], minMedia: 1, maxMedia: 1, video: igReel },
      story: {
        mediaKinds: ['image', 'video'],
        minMedia: 1,
        maxMedia: 1,
        image: igStoryImage,
        video: igStoryVideo,
        captionSupported: false,
        notes: 'Stories publishing requires an Instagram business account.',
      },
    },
  },

  facebook: {
    platform: 'facebook',
    label: 'Facebook Page',
    captionMaxLength: 63206,
    verified: false,
    docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
    postTypes: {
      text: { mediaKinds: [], minMedia: 0, maxMedia: 0 },
      image: {
        mediaKinds: ['image'],
        minMedia: 1,
        maxMedia: 10,
        image: { formats: [...JPEG_PNG, 'image/gif'], maxSizeMB: 10 },
      },
      video: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: MP4_MOV, maxSizeMB: 10240, minDurationSec: 1, maxDurationSec: 14400 },
      },
      reel: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: MP4_MOV, maxSizeMB: 1000, minDurationSec: 3, maxDurationSec: 90, minAspect: 0.5, maxAspect: 0.6 },
      },
      // Verified 2026-09-26: developers.facebook.com/docs/page-stories-api
      story: {
        mediaKinds: ['image', 'video'],
        minMedia: 1,
        maxMedia: 1,
        image: { formats: [...JPEG_PNG, 'image/gif'], maxSizeMB: 10 },
        video: { formats: MP4_MOV, maxSizeMB: 1000, minDurationSec: 3, maxDurationSec: 90, minAspect: 0.5, maxAspect: 0.6 },
        captionSupported: false,
      },
    },
  },

  // Threads: verified 2026-09-26 against developers.facebook.com/docs/threads/posts
  threads: {
    platform: 'threads',
    label: 'Threads',
    captionMaxLength: 500,
    supportsThread: true,
    maxThreadParts: 10,
    verified: true,
    verifiedAt: '2026-09-26',
    docsUrl: 'https://developers.facebook.com/docs/threads/posts',
    postTypes: {
      text: { mediaKinds: [], minMedia: 0, maxMedia: 0 },
      image: { mediaKinds: ['image'], minMedia: 1, maxMedia: 1, image: threadsImage },
      video: { mediaKinds: ['video'], minMedia: 1, maxMedia: 1, video: threadsVideo },
      carousel: { mediaKinds: ['image', 'video'], minMedia: 2, maxMedia: 20, image: threadsImage, video: threadsVideo },
    },
  },

  // LinkedIn: verified 2026-09-26 against the Posts, Images, MultiImage, Videos and Documents API docs
  // (learn.microsoft.com/linkedin/marketing/community-management/shares/*). Commentary length is not
  // stated in the API docs; 3000 is LinkedIn's post editor limit.
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn Page',
    captionMaxLength: 3000,
    verified: true,
    verifiedAt: '2026-09-26',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
    postTypes: {
      text: { mediaKinds: [], minMedia: 0, maxMedia: 0 },
      image: {
        mediaKinds: ['image'],
        minMedia: 1,
        maxMedia: 20,
        // Limit is by pixel count (< 36,152,320 px), not file size; 100 MB is a practical upload cap.
        image: { formats: [...JPEG_PNG, 'image/gif'], maxSizeMB: 100 },
        notes: '2–20 images are published as a multi-image post.',
      },
      video: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: ['video/mp4'], maxSizeMB: 500, minDurationSec: 3, maxDurationSec: 1800 },
      },
      document: {
        mediaKinds: ['document'],
        minMedia: 1,
        maxMedia: 1,
        document: { formats: ['application/pdf'], maxSizeMB: 100, maxPages: 300 },
      },
    },
  },

  x: {
    platform: 'x',
    label: 'X',
    captionMaxLength: 280,
    urlWeight: 23,
    supportsThread: true,
    maxThreadParts: 25,
    verified: false,
    docsUrl: 'https://docs.x.com/x-api/posts/manage-tweets/introduction',
    postTypes: {
      text: { mediaKinds: [], minMedia: 0, maxMedia: 0 },
      image: {
        mediaKinds: ['image'],
        minMedia: 1,
        maxMedia: 4,
        image: { formats: [...JPEG_PNG, 'image/webp', 'image/gif'], maxSizeMB: 5 },
      },
      video: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        // docs.x.com media upload: tweet_video default 20 min / 8 GB (longer with Premium).
        video: { formats: ['video/mp4', 'video/quicktime', 'video/webm'], maxSizeMB: 8192, minDurationSec: 0.5, maxDurationSec: 1200 },
      },
    },
  },

  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    captionMaxLength: 2200,
    verified: false,
    docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    postTypes: {
      video: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: ['video/mp4', 'video/quicktime', 'video/webm'], maxSizeMB: 4096, minDurationSec: 3, maxDurationSec: 600 },
        notes: 'Unaudited apps can only post with SELF_ONLY (private) visibility.',
      },
      carousel: {
        mediaKinds: ['image'],
        minMedia: 1,
        maxMedia: 35,
        image: { formats: ['image/jpeg', 'image/webp'], maxSizeMB: 20 },
        notes: 'TikTok photo mode post.',
      },
    },
  },

  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    captionMaxLength: 5000, // description
    verified: false,
    docsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
    postTypes: {
      video: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: [...MP4_MOV, 'video/webm'], maxSizeMB: 256000, minDurationSec: 1, maxDurationSec: 43200 },
      },
      short: {
        mediaKinds: ['video'],
        minMedia: 1,
        maxMedia: 1,
        video: { formats: [...MP4_MOV, 'video/webm'], maxSizeMB: 256000, minDurationSec: 1, maxDurationSec: 180, maxAspect: 1 },
        notes: 'Shorts are vertical or square videos up to 3 minutes.',
      },
    },
  },
};

export function getSpec(platform: Platform): PlatformSpec {
  return PLATFORM_SPECS[platform];
}
