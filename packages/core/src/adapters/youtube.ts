// YouTube uploads via the resumable upload protocol. Docs (checked 2026-09-26):
//   developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
//   developers.google.com/youtube/v3/docs/videos/insert
// Videos from unaudited API projects are forced to private by YouTube.

import { PublishError } from './errors';
import { request, type FetchLike } from './http';
import type { AccountCredentials, PublishRequest, PublishResult, SocialAdapter } from './types';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
/** Chunks must be multiples of 256 KB. */
const CHUNK = 256 * 1024 * 32; // 8 MB
/** Upload at most this much per worker run, then continue on the next run. */
const BYTES_PER_RUN = 200 * 1024 * 1024;

interface YouTubeOptions {
  fetch?: FetchLike;
  bytesPerRun?: number;
}

type UploadState = { uploadUrl: string; offset: number };

export class YouTubeAdapter implements SocialAdapter {
  readonly platform = 'youtube' as const;
  private readonly fetch: FetchLike;
  private readonly bytesPerRun: number;

  constructor(opts: YouTubeOptions = {}) {
    this.fetch = opts.fetch ?? fetch;
    this.bytesPerRun = opts.bytesPerRun ?? BYTES_PER_RUN;
  }

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    if (req.postType !== 'video' && req.postType !== 'short') {
      throw new PublishError('invalid_content', `YouTube does not support ${req.postType} posts`);
    }
    const media = req.media[0]!;
    const o = req.options as { title: string; tags?: string[]; privacyStatus?: string; categoryId?: string; madeForKids: boolean };

    const res = await request(this.fetch, UPLOAD_URL, {
      stage: 'prepare',
      what: 'YouTube upload session',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(media.sizeBytes),
        'X-Upload-Content-Type': media.mimeType,
      },
      body: JSON.stringify({
        snippet: { title: o.title, description: req.caption, tags: o.tags ?? [], categoryId: o.categoryId ?? '22' },
        status: { privacyStatus: o.privacyStatus ?? 'public', selfDeclaredMadeForKids: o.madeForKids },
      }),
    });
    const uploadUrl = res.headers.get('location');
    if (!uploadUrl) throw new PublishError('transient', 'YouTube did not return an upload URL');
    return this.upload(account, req, { uploadUrl, offset: 0 });
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as UploadState | undefined;
    if (!state?.uploadUrl) throw new PublishError('permanent', 'Missing YouTube upload state');
    // Ask YouTube how much it already has; a previous run may have been cut off.
    const total = req.media[0]!.sizeBytes;
    const res = await this.fetch(state.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Range': `bytes */${total}` },
    }).catch((cause) => {
      throw new PublishError('transient', `YouTube upload status: network error`, { cause });
    });
    if (res.status === 200 || res.status === 201) return this.finished((await res.json()) as { id?: string; status?: { privacyStatus?: string } }, req);
    if (res.status !== 308) {
      if (res.status === 404 || res.status === 410) throw new PublishError('invalid_content', 'YouTube upload session expired; schedule the post again');
      throw new PublishError(res.status >= 500 ? 'transient' : 'permanent', `YouTube upload status failed (${res.status})`);
    }
    return this.upload(account, req, { uploadUrl: state.uploadUrl, offset: nextOffset(res.headers.get('range')) });
  }

  private async upload(account: AccountCredentials, req: PublishRequest, state: UploadState): Promise<PublishResult> {
    const media = req.media[0]!;
    const total = media.sizeBytes;
    let offset = state.offset;
    const stopAt = Math.min(total, offset + this.bytesPerRun);

    while (offset < stopAt) {
      const end = Math.min(offset + CHUNK, total) - 1;
      const isLast = end === total - 1;
      const bytes = await request(this.fetch, media.url, {
        stage: 'prepare',
        what: 'Reading video from storage',
        headers: { Range: `bytes=${offset}-${end}` },
        timeoutMs: 120_000,
      }).then((r) => r.arrayBuffer());

      let res: Response;
      try {
        res = await this.fetch(state.uploadUrl, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Range': `bytes ${offset}-${end}/${total}` },
          body: bytes,
          signal: AbortSignal.timeout(120_000),
        });
      } catch (cause) {
        // The last chunk completes the upload, which publishes the video.
        throw new PublishError(isLast ? 'ambiguous' : 'transient', 'YouTube upload: network error', { cause });
      }

      if (res.status === 200 || res.status === 201) return this.finished((await res.json()) as { id?: string; status?: { privacyStatus?: string } }, req);
      if (res.status === 308) {
        offset = nextOffset(res.headers.get('range'));
        continue;
      }
      const errorClass = res.status === 401 ? 'auth_expired' : res.status === 403 && (await res.clone().text()).includes('quota') ? 'rate_limited' : res.status >= 500 ? (isLast ? 'ambiguous' : 'transient') : 'invalid_content';
      throw new PublishError(errorClass, `YouTube upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`, {
        retryAfterSec: errorClass === 'rate_limited' ? 3600 : undefined,
      });
    }
    // More to send: continue in the next worker run.
    return { status: 'processing', checkAfterSec: 1, resumeState: { uploadUrl: state.uploadUrl, offset } satisfies UploadState };
  }

  private finished(video: { id?: string; status?: { privacyStatus?: string } }, req: PublishRequest): PublishResult {
    const requested = (req.options as { privacyStatus?: string }).privacyStatus ?? 'public';
    if (!video.id) throw new PublishError('ambiguous', 'YouTube finished the upload but returned no video ID');
    return {
      status: 'published',
      externalPostId: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      publishedAt: new Date(),
      warning:
        video.status?.privacyStatus === 'private' && requested !== 'private'
          ? 'YouTube set the video to private. Unaudited API projects can only upload private videos.'
          : undefined,
    };
  }
}

/** "bytes=0-1048575" -> 1048576; no header means nothing received yet. */
function nextOffset(range: string | null): number {
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}
