// TikTok Content Posting API (Direct Post).
// UNVERIFIED: developers.tiktok.com was unreachable when this was written (2026-09-26); built from
// secondary sources. Check against developers.tiktok.com/doc/content-posting-api-reference-direct-post
// before enabling in production. Unaudited apps can only post SELF_ONLY (private).

import { PublishError, type PublishErrorClass } from './errors';
import { request, type FetchLike, type RequestStage } from './http';
import type { AccountCredentials, PublishRequest, PublishResult, SocialAdapter } from './types';

const API = 'https://open.tiktokapis.com/v2';
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024; // between 5 MB and 64 MB; the remainder is merged into the last chunk
const BYTES_PER_RUN = 200 * 1024 * 1024;
const STATUS_POLL_SEC = 15;

interface TikTokOptions {
  fetch?: FetchLike;
  bytesPerRun?: number;
}

type TikTokState =
  | { step: 'upload'; publishId: string; uploadUrl: string; chunkSize: number; chunkCount: number; nextChunk: number }
  | { step: 'status'; publishId: string };

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code: string; message?: string };
}

function classify(code: string): PublishErrorClass {
  if (/access_token|token_invalid|token_expired|scope_not_authorized/.test(code)) return 'auth_expired';
  if (/rate_limit|spam_risk/.test(code)) return 'rate_limited';
  if (/internal|timeout/.test(code)) return 'transient';
  return 'invalid_content';
}

export class TikTokAdapter implements SocialAdapter {
  readonly platform = 'tiktok' as const;
  private readonly fetch: FetchLike;
  private readonly bytesPerRun: number;

  constructor(opts: TikTokOptions = {}) {
    this.fetch = opts.fetch ?? fetch;
    this.bytesPerRun = opts.bytesPerRun ?? BYTES_PER_RUN;
  }

  private async call<T>(path: string, token: string, body: unknown, stage: RequestStage, what: string): Promise<T> {
    let res: Response;
    try {
      res = await request(this.fetch, `${API}${path}`, {
        stage,
        what,
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // TikTok puts the real reason in error.code; refine the HTTP-based classification.
      const err = e as PublishError;
      const code = err.message.match(/"code":"([a-z_]+)"/)?.[1];
      if (code && err.errorClass !== 'ambiguous') throw new PublishError(classify(code), `${what}: ${code}`, { retryAfterSec: 3600 });
      throw e;
    }
    const json = (await res.json()) as TikTokEnvelope<T>;
    if (json.error && json.error.code !== 'ok') {
      throw new PublishError(classify(json.error.code), `${what}: ${json.error.code} ${json.error.message ?? ''}`.trim(), { retryAfterSec: 3600 });
    }
    return json.data as T;
  }

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const token = account.accessToken;
    const o = req.options as {
      privacyLevel: string;
      disableComment?: boolean;
      disableDuet?: boolean;
      disableStitch?: boolean;
      coverTimestampMs?: number;
      brandContent?: boolean;
      brandOrganic?: boolean;
    };

    // TikTok requires checking the creator's current settings before every post.
    const creator = await this.call<{ privacy_level_options: string[]; max_video_post_duration_sec?: number }>(
      '/post/publish/creator_info/query/', token, {}, 'prepare', 'TikTok creator info',
    );
    if (!creator.privacy_level_options.includes(o.privacyLevel)) {
      throw new PublishError('invalid_content', `This TikTok account can't post with "${o.privacyLevel}". Allowed: ${creator.privacy_level_options.join(', ')}`);
    }
    if (o.brandContent && o.privacyLevel === 'SELF_ONLY') {
      throw new PublishError('invalid_content', 'Branded (paid partnership) TikTok posts cannot be private');
    }

    if (req.postType === 'carousel') {
      const urls = req.media.map((m) => m.proxyUrl);
      if (urls.some((u) => !u)) {
        throw new PublishError('permanent', 'TikTok photo posts need media served from your verified domain (APP_URL must be public HTTPS)');
      }
      const title = req.caption.split('\n')[0]!.slice(0, 90);
      const data = await this.call<{ publish_id: string }>(
        '/post/publish/content/init/',
        token,
        {
          post_info: {
            title,
            description: req.caption,
            privacy_level: o.privacyLevel,
            disable_comment: !!o.disableComment,
            brand_content_toggle: !!o.brandContent,
            brand_organic_toggle: !!o.brandOrganic,
          },
          source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls },
          post_mode: 'DIRECT_POST',
          media_type: 'PHOTO',
        },
        'publish',
        'TikTok photo post',
      );
      return { status: 'processing', checkAfterSec: STATUS_POLL_SEC, resumeState: { step: 'status', publishId: data.publish_id } satisfies TikTokState };
    }

    if (req.postType !== 'video') throw new PublishError('invalid_content', `TikTok does not support ${req.postType} posts`);
    const media = req.media[0]!;
    if (creator.max_video_post_duration_sec && media.durationSec && media.durationSec > creator.max_video_post_duration_sec) {
      throw new PublishError('invalid_content', `This TikTok account can post videos up to ${creator.max_video_post_duration_sec}s`);
    }

    const size = media.sizeBytes;
    const chunkSize = size <= MAX_SINGLE_CHUNK ? size : CHUNK;
    const chunkCount = size <= MAX_SINGLE_CHUNK ? 1 : Math.floor(size / CHUNK);
    const init = await this.call<{ publish_id: string; upload_url: string }>(
      '/post/publish/video/init/',
      token,
      {
        post_info: {
          title: req.caption,
          privacy_level: o.privacyLevel,
          disable_comment: !!o.disableComment,
          disable_duet: !!o.disableDuet,
          disable_stitch: !!o.disableStitch,
          ...(o.coverTimestampMs !== undefined ? { video_cover_timestamp_ms: o.coverTimestampMs } : {}),
          brand_content_toggle: !!o.brandContent,
          brand_organic_toggle: !!o.brandOrganic,
        },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: chunkCount },
      },
      'prepare',
      'TikTok video init',
    );
    return this.uploadChunks(req, { step: 'upload', publishId: init.publish_id, uploadUrl: init.upload_url, chunkSize, chunkCount, nextChunk: 0 });
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as TikTokState | undefined;
    if (!state) throw new PublishError('permanent', 'Missing TikTok upload state');
    if (state.step === 'upload') return this.uploadChunks(req, state);

    const data = await this.call<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
      '/post/publish/status/fetch/', account.accessToken, { publish_id: state.publishId }, 'prepare', 'TikTok status',
    );
    if (data.status === 'FAILED') throw new PublishError('invalid_content', `TikTok rejected the post: ${data.fail_reason ?? 'unknown reason'}`);
    if (data.status !== 'PUBLISH_COMPLETE') return { status: 'processing', checkAfterSec: STATUS_POLL_SEC, resumeState: state };

    const postId = data.publicaly_available_post_id?.[0];
    return {
      status: 'published',
      externalPostId: postId ? String(postId) : state.publishId,
      url: postId ? `https://www.tiktok.com/video/${postId}` : undefined,
      publishedAt: new Date(),
      warning: postId ? undefined : 'Posted privately (only visible to the account owner).',
    };
  }

  private async uploadChunks(req: PublishRequest, state: Extract<TikTokState, { step: 'upload' }>): Promise<PublishResult> {
    const media = req.media[0]!;
    const total = media.sizeBytes;
    let budget = this.bytesPerRun;

    while (state.nextChunk < state.chunkCount) {
      if (budget <= 0) return { status: 'processing', checkAfterSec: 1, resumeState: state };
      const i = state.nextChunk;
      const start = i * state.chunkSize;
      const end = i === state.chunkCount - 1 ? total - 1 : start + state.chunkSize - 1;
      const bytes = await request(this.fetch, media.url, {
        stage: 'prepare',
        what: 'Reading video from storage',
        headers: { Range: `bytes=${start}-${end}` },
        timeoutMs: 120_000,
      }).then((r) => r.arrayBuffer());

      // The final chunk completes a Direct Post, so it counts as the publishing step.
      await request(this.fetch, state.uploadUrl, {
        stage: i === state.chunkCount - 1 ? 'publish' : 'prepare',
        what: 'TikTok video upload',
        method: 'PUT',
        headers: { 'Content-Type': media.mimeType, 'Content-Range': `bytes ${start}-${end}/${total}` },
        body: bytes,
        timeoutMs: 120_000,
      });
      state.nextChunk += 1;
      budget -= bytes.byteLength;
    }
    return { status: 'processing', checkAfterSec: STATUS_POLL_SEC, resumeState: { step: 'status', publishId: state.publishId } satisfies TikTokState };
  }
}
