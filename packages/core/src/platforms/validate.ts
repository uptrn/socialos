import { PLATFORM_OPTIONS } from './options';
import { getSpec } from './specs';
import type { MediaInfo, Platform, PostType, PostTypeSpec } from './types';

export interface VariantInput {
  platform: Platform;
  postType: PostType;
  caption: string;
  /** Additional posts after the first, for X / Threads threads. */
  threadParts?: string[];
  media: MediaInfo[];
  options: unknown;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  field: string;
  message: string;
}

const URL_RE = /https?:\/\/[^\s]+/g;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const MB = 1024 * 1024;

/** Length as the platform counts it. X counts every URL as a fixed 23 chars. */
export function platformTextLength(text: string, urlWeight?: number): number {
  if (!urlWeight) return [...text].length;
  const urls = text.match(URL_RE) ?? [];
  const withoutUrls = text.replace(URL_RE, '');
  return [...withoutUrls].length + urls.length * urlWeight;
}

export function countHashtags(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length;
}

const MENTION_RE = /(^|\s)@[\p{L}\p{N}_.]+/gu;

export function countMentions(text: string): number {
  return (text.match(MENTION_RE) ?? []).length;
}

export function validateVariant(input: VariantInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const spec = getSpec(input.platform);
  const typeSpec = spec.postTypes[input.postType];

  if (!typeSpec) {
    const supported = Object.keys(spec.postTypes).join(', ');
    issues.push(err('unsupported_post_type', 'postType', `${spec.label} does not support "${input.postType}" posts. Supported: ${supported}.`));
    return issues;
  }

  validateCaption(input, typeSpec, issues);
  validateThread(input, issues);
  validateMedia(input, typeSpec, issues);
  validateOptions(input, issues);

  if (!spec.verified) {
    issues.push({
      severity: 'warning',
      code: 'limits_unverified',
      field: 'platform',
      message: `${spec.label} limits have not been verified against current platform documentation.`,
    });
  }
  return issues;
}

function validateCaption(input: VariantInput, typeSpec: PostTypeSpec, issues: ValidationIssue[]) {
  const spec = getSpec(input.platform);
  const caption = input.caption.trim();

  if (typeSpec.captionSupported === false) {
    if (caption) {
      issues.push(warn('caption_ignored', 'caption', `${spec.label} ${input.postType} posts do not show a caption; it will be ignored.`));
    }
    return;
  }

  if (!caption && typeSpec.mediaKinds.length === 0) {
    issues.push(err('caption_required', 'caption', 'Text posts need a caption.'));
  }

  const max = typeSpec.captionMaxLength ?? spec.captionMaxLength;
  const length = platformTextLength(caption, spec.urlWeight);
  if (length > max) {
    issues.push(err('caption_too_long', 'caption', `Caption is ${length} characters; ${spec.label} allows ${max}.`));
  }

  if (spec.maxHashtags !== undefined) {
    const tags = countHashtags(caption);
    if (tags > spec.maxHashtags) {
      issues.push(err('too_many_hashtags', 'caption', `${tags} hashtags; ${spec.label} allows ${spec.maxHashtags}.`));
    }
  }

  if (spec.maxMentions !== undefined) {
    const mentions = countMentions(caption);
    if (mentions > spec.maxMentions) {
      issues.push(err('too_many_mentions', 'caption', `${mentions} @ mentions; ${spec.label} allows ${spec.maxMentions}.`));
    }
  }
}

function validateThread(input: VariantInput, issues: ValidationIssue[]) {
  const parts = input.threadParts ?? [];
  if (parts.length === 0) return;
  const spec = getSpec(input.platform);

  if (!spec.supportsThread) {
    issues.push(err('thread_unsupported', 'threadParts', `${spec.label} does not support threads.`));
    return;
  }
  const maxParts = spec.maxThreadParts ?? Infinity;
  if (parts.length + 1 > maxParts) {
    issues.push(err('thread_too_long', 'threadParts', `Thread has ${parts.length + 1} posts; maximum is ${maxParts}.`));
  }
  parts.forEach((part, i) => {
    const length = platformTextLength(part.trim(), spec.urlWeight);
    if (!part.trim()) issues.push(err('thread_part_empty', `threadParts.${i}`, `Thread post ${i + 2} is empty.`));
    if (length > spec.captionMaxLength) {
      issues.push(err('thread_part_too_long', `threadParts.${i}`, `Thread post ${i + 2} is ${length} characters; limit is ${spec.captionMaxLength}.`));
    }
  });
}

function validateMedia(input: VariantInput, typeSpec: PostTypeSpec, issues: ValidationIssue[]) {
  const { media } = input;
  const spec = getSpec(input.platform);

  if (media.length < typeSpec.minMedia) {
    issues.push(err('too_few_media', 'media', `${spec.label} ${input.postType} needs at least ${typeSpec.minMedia} media item(s).`));
  }
  if (media.length > typeSpec.maxMedia) {
    issues.push(err('too_many_media', 'media', `${spec.label} ${input.postType} allows at most ${typeSpec.maxMedia} media item(s).`));
  }

  media.forEach((m, i) => {
    const field = `media.${i}`;
    if (!typeSpec.mediaKinds.includes(m.kind)) {
      issues.push(err('media_kind_not_allowed', field, `${m.kind} files are not allowed in ${spec.label} ${input.postType} posts.`));
      return;
    }
    const rules = m.kind === 'image' ? typeSpec.image : m.kind === 'video' ? typeSpec.video : typeSpec.document;
    if (!rules) return;

    if (!rules.formats.includes(m.mimeType)) {
      issues.push(err('media_format', field, `${m.mimeType} is not accepted; use ${rules.formats.join(', ')}.`));
    }
    if (m.sizeBytes > rules.maxSizeMB * MB) {
      issues.push(err('media_too_large', field, `File is ${(m.sizeBytes / MB).toFixed(1)} MB; limit is ${rules.maxSizeMB} MB.`));
    }

    if ('minAspect' in rules || 'maxAspect' in rules) {
      checkAspect(m, rules as { minAspect?: number; maxAspect?: number }, field, issues);
    }

    if (m.kind === 'image' && m.width && typeSpec.image) {
      const { minWidth, maxWidth } = typeSpec.image;
      if (minWidth !== undefined && m.width < minWidth) {
        issues.push(err('image_too_narrow', field, `Image is ${m.width}px wide; ${spec.label} needs at least ${minWidth}px.`));
      }
      if (maxWidth !== undefined && m.width > maxWidth) {
        issues.push(err('image_too_wide', field, `Image is ${m.width}px wide; ${spec.label} allows at most ${maxWidth}px. Resize it before posting.`));
      }
    }

    if (m.kind === 'video' && typeSpec.video) {
      const v = typeSpec.video;
      if (m.durationSec === undefined) {
        issues.push(warn('duration_unknown', field, 'Video duration could not be read; it will be checked again before publishing.'));
      } else if (m.durationSec < v.minDurationSec || m.durationSec > v.maxDurationSec) {
        issues.push(err('video_duration', field, `Video is ${Math.round(m.durationSec)}s; ${spec.label} ${input.postType} allows ${v.minDurationSec}–${v.maxDurationSec}s.`));
      }
    }

    if (m.kind === 'document' && typeSpec.document?.maxPages && m.pageCount && m.pageCount > typeSpec.document.maxPages) {
      issues.push(err('document_too_many_pages', field, `Document has ${m.pageCount} pages; limit is ${typeSpec.document.maxPages}.`));
    }
  });
}

function checkAspect(m: MediaInfo, rules: { minAspect?: number; maxAspect?: number }, field: string, issues: ValidationIssue[]) {
  if (!m.width || !m.height) return;
  const aspect = m.width / m.height;
  const tolerance = 0.01;
  if (rules.minAspect !== undefined && aspect < rules.minAspect - tolerance) {
    issues.push(err('aspect_ratio', field, `Aspect ratio ${aspect.toFixed(2)} is too tall; minimum is ${rules.minAspect.toFixed(2)} (width ÷ height).`));
  }
  if (rules.maxAspect !== undefined && aspect > rules.maxAspect + tolerance) {
    issues.push(err('aspect_ratio', field, `Aspect ratio ${aspect.toFixed(2)} is too wide; maximum is ${rules.maxAspect.toFixed(2)} (width ÷ height).`));
  }
}

function validateOptions(input: VariantInput, issues: ValidationIssue[]) {
  const schema = PLATFORM_OPTIONS[input.platform];
  const result = schema.safeParse(input.options ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push(err('invalid_option', `options.${issue.path.join('.')}`, issue.message));
    }
  }
}

function err(code: string, field: string, message: string): ValidationIssue {
  return { severity: 'error', code, field, message };
}

function warn(code: string, field: string, message: string): ValidationIssue {
  return { severity: 'warning', code, field, message };
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
