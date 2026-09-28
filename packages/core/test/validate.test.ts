import { describe, expect, it } from 'vitest';
import { countHashtags, hasBlockingIssues, platformTextLength, validateVariant, type MediaInfo } from '../src';

const MB = 1024 * 1024;
const jpeg = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  id: 'img1', kind: 'image', mimeType: 'image/jpeg', sizeBytes: 1 * MB, width: 1080, height: 1350, ...over,
});
const mp4 = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  id: 'vid1', kind: 'video', mimeType: 'video/mp4', sizeBytes: 50 * MB, width: 1080, height: 1920, durationSec: 30, ...over,
});
const codes = (issues: { code: string; severity: string }[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('text length', () => {
  it('counts URLs as 23 characters for X', () => {
    expect(platformTextLength('see https://example.com/a/very/long/path/that/goes/on', 23)).toBe(4 + 23);
  });
  it('counts emoji as one character', () => {
    expect(platformTextLength('hi 👋')).toBe(4);
  });
  it('counts hashtags', () => {
    expect(countHashtags('#one two #three #four_5 not#this')).toBe(3);
  });
});

describe('validateVariant', () => {
  it('accepts a valid Instagram image post with no issues (limits verified)', () => {
    const issues = validateVariant({ platform: 'instagram', postType: 'image', caption: 'Hello #saas', media: [jpeg()], options: {} });
    expect(issues).toEqual([]);
  });

  it('warns that limits are unverified for platforms not yet checked', () => {
    const issues = validateVariant({ platform: 'x', postType: 'text', caption: 'hi', media: [], options: {} });
    expect(issues.map((i) => i.code)).toEqual(['limits_unverified']);
  });

  it('enforces Instagram image width and @ mention limits', () => {
    const wide = validateVariant({ platform: 'instagram', postType: 'image', caption: 'x', media: [jpeg({ width: 3000, height: 3000 })], options: {} });
    expect(codes(wide)).toContain('image_too_wide');
    const mentions = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ');
    expect(codes(validateVariant({ platform: 'instagram', postType: 'image', caption: mentions, media: [jpeg()], options: {} }))).toContain('too_many_mentions');
  });

  it('rejects Instagram reels over 300 MB', () => {
    const issues = validateVariant({ platform: 'instagram', postType: 'reel', caption: '', media: [mp4({ sizeBytes: 400 * MB })], options: {} });
    expect(codes(issues)).toContain('media_too_large');
  });

  it('rejects post types a platform does not support', () => {
    const issues = validateVariant({ platform: 'instagram', postType: 'text', caption: 'Hi', media: [], options: {} });
    expect(codes(issues)).toEqual(['unsupported_post_type']);
  });

  it('rejects captions over the limit and too many hashtags', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    const issues = validateVariant({ platform: 'instagram', postType: 'image', caption: 'x'.repeat(2200) + ' ' + tags, media: [jpeg()], options: {} });
    expect(codes(issues)).toEqual(expect.arrayContaining(['caption_too_long', 'too_many_hashtags']));
  });

  it('enforces X length with URL weighting', () => {
    const caption = 'a'.repeat(260) + ' https://example.com';
    const issues = validateVariant({ platform: 'x', postType: 'text', caption, media: [], options: {} });
    expect(codes(issues)).toContain('caption_too_long');
  });

  it('checks media count, format, size and aspect ratio', () => {
    const issues = validateVariant({
      platform: 'instagram',
      postType: 'carousel',
      caption: '',
      media: [jpeg({ mimeType: 'image/png' }), jpeg({ sizeBytes: 20 * MB, id: 'b' }), jpeg({ width: 1080, height: 1920, id: 'c' })],
      options: {},
    });
    expect(codes(issues)).toEqual(expect.arrayContaining(['media_format', 'media_too_large', 'aspect_ratio']));
  });

  it('requires at least two items in a carousel', () => {
    const issues = validateVariant({ platform: 'instagram', postType: 'carousel', caption: '', media: [jpeg()], options: {} });
    expect(codes(issues)).toContain('too_few_media');
  });

  it('checks video duration', () => {
    const issues = validateVariant({ platform: 'x', postType: 'video', caption: 'clip', media: [mp4({ durationSec: 1500 })], options: {} });
    expect(codes(issues)).toContain('video_duration');
  });

  it('warns that story captions are ignored', () => {
    const issues = validateVariant({ platform: 'instagram', postType: 'story', caption: 'hidden', media: [jpeg()], options: {} });
    expect(issues.map((i) => i.code)).toContain('caption_ignored');
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('validates platform options', () => {
    const missing = validateVariant({ platform: 'youtube', postType: 'video', caption: 'desc', media: [mp4()], options: {} });
    expect(codes(missing)).toContain('invalid_option');
    const ok = validateVariant({ platform: 'youtube', postType: 'video', caption: 'desc', media: [mp4()], options: { title: 'Demo', madeForKids: false } });
    expect(hasBlockingIssues(ok)).toBe(false);
  });

  it('requires a TikTok privacy level', () => {
    const issues = validateVariant({ platform: 'tiktok', postType: 'video', caption: 'hi', media: [mp4()], options: {} });
    expect(codes(issues)).toContain('invalid_option');
  });

  it('validates thread parts', () => {
    const issues = validateVariant({ platform: 'x', postType: 'text', caption: 'part 1', threadParts: ['', 'b'.repeat(300)], media: [], options: {} });
    expect(codes(issues)).toEqual(expect.arrayContaining(['thread_part_empty', 'thread_part_too_long']));
    const fb = validateVariant({ platform: 'facebook', postType: 'text', caption: 'a', threadParts: ['b'], media: [], options: {} });
    expect(codes(fb)).toContain('thread_unsupported');
  });
});
