// X (Twitter) API v2. Docs (checked 2026-09-26):
//   Posts:  docs.x.com/x-api/posts/manage-tweets/quickstart
//   Media:  docs.x.com/x-api/media/quickstart/media-upload-chunked
//           docs.x.com/x-api/media/initialize-media-upload | append-media-upload | get-media-upload-status

import { PublishError } from './errors';
import { request, requestJson, type FetchLike } from './http';
import type { AccountCredentials, PublishMedia, PublishRequest, PublishResult, SocialAdapter } from './types';

const API = 'https://api.x.com/2';
const SEGMENT = 4 * 1024 * 1024; // must be <= 5 MB
const BYTES_PER_RUN = 200 * 1024 * 1024;

interface XOptions {
  fetch?: FetchLike;
  bytesPerRun?: number;
}

interface UploadItem {
  id: string;
  offset: number; // bytes appended so far
  segment: number; // next segment_index
  finalized: boolean;
  /** Finalize reported processing_info, so STATUS must be polled. */
  processing?: boolean;
}
type XState = { items: UploadItem[] };

function category(m: PublishMedia): string {
  if (m.kind === 'video') return 'tweet_video';
  return m.mimeType === 'image/gif' ? 'tweet_gif' : 'tweet_image';
}

export class XAdapter implements SocialAdapter {
  readonly platform = 'x' as const;
  private readonly fetch: FetchLike;
  private readonly bytesPerRun: number;

  constructor(opts: XOptions = {}) {
    this.fetch = opts.fetch ?? fetch;
    this.bytesPerRun = opts.bytesPerRun ?? BYTES_PER_RUN;
  }

  private auth(token: string, json = true): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    if (!req.media.length) return this.createPosts(account, req, []);

    const items: UploadItem[] = [];
    for (const m of req.media) {
      const init = await requestJson<{ data: { id: string } }>(this.fetch, `${API}/media/upload/initialize`, {
        stage: 'prepare',
        what: 'X media upload init',
        method: 'POST',
        headers: this.auth(account.accessToken),
        body: JSON.stringify({ media_type: m.mimeType, total_bytes: m.sizeBytes, media_category: category(m) }),
      });
      items.push({ id: init.data.id, offset: 0, segment: 0, finalized: false });
    }
    return this.continue(account, req, { items });
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as XState | undefined;
    if (!state?.items) throw new PublishError('permanent', 'Missing X upload state');
    return this.continue(account, req, state);
  }

  /** Uploads remaining bytes (bounded per run), finalizes, waits for processing, then posts. */
  private async continue(account: AccountCredentials, req: PublishRequest, state: XState): Promise<PublishResult> {
    let budget = this.bytesPerRun;

    for (const [i, item] of state.items.entries()) {
      const media = req.media[i]!;
      while (item.offset < media.sizeBytes) {
        if (budget <= 0) return { status: 'processing', checkAfterSec: 1, resumeState: state };
        const end = Math.min(item.offset + SEGMENT, media.sizeBytes) - 1;
        const bytes = await request(this.fetch, media.url, {
          stage: 'prepare',
          what: 'Reading media from storage',
          headers: { Range: `bytes=${item.offset}-${end}` },
          timeoutMs: 120_000,
        }).then((r) => r.arrayBuffer());

        const form = new FormData();
        form.set('segment_index', String(item.segment));
        form.set('media', new Blob([bytes], { type: media.mimeType }));
        await request(this.fetch, `${API}/media/upload/${item.id}/append`, {
          stage: 'prepare',
          what: 'X media upload',
          method: 'POST',
          headers: this.auth(account.accessToken, false),
          body: form,
          timeoutMs: 120_000,
        });
        item.offset = end + 1;
        item.segment += 1;
        budget -= bytes.byteLength;
      }
      if (!item.finalized) {
        const fin = await requestJson<{ data?: { processing_info?: unknown } }>(this.fetch, `${API}/media/upload/${item.id}/finalize`, {
          stage: 'prepare',
          what: 'X media finalize',
          method: 'POST',
          headers: this.auth(account.accessToken, false),
        });
        item.finalized = true;
        item.processing = !!fin.data?.processing_info;
      }
    }

    // Wait for server-side processing (videos, GIFs).
    let wait = 0;
    for (const item of state.items.filter((i) => i.processing)) {
      const status = await requestJson<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(
        this.fetch,
        `${API}/media/upload?command=STATUS&media_id=${item.id}`,
        { stage: 'prepare', what: 'X media status', headers: this.auth(account.accessToken, false) },
      );
      const info = status.data.processing_info;
      if (info?.state === 'failed') throw new PublishError('invalid_content', 'X could not process the media');
      if (!info || info.state === 'succeeded') item.processing = false;
      else wait = Math.max(wait, info.check_after_secs ?? 5);
    }
    if (wait > 0) return { status: 'processing', checkAfterSec: wait, resumeState: state };

    return this.createPosts(account, req, state.items.map((i) => i.id));
  }

  private async createPosts(account: AccountCredentials, req: PublishRequest, mediaIds: string[]): Promise<PublishResult> {
    const replySettings = (req.options as { replySettings?: string }).replySettings;
    const base = replySettings && replySettings !== 'everyone' ? { reply_settings: replySettings } : {};

    const first = await this.tweet(account, { ...base, text: req.caption, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) });

    // Thread: each part replies to the previous one. The first post is already live,
    // so a failure here is reported as a warning rather than failing the job.
    let previous = first;
    let warning: string | undefined;
    for (const [i, part] of (req.threadParts ?? []).entries()) {
      if (!part.trim()) continue;
      try {
        previous = await this.tweet(account, { ...base, text: part, reply: { in_reply_to_tweet_id: previous } });
      } catch (e) {
        warning = `Thread stopped at post ${i + 2}: ${(e as Error).message}`;
        break;
      }
    }
    return { status: 'published', externalPostId: first, url: `https://x.com/i/web/status/${first}`, publishedAt: new Date(), warning };
  }

  private async tweet(account: AccountCredentials, body: Record<string, unknown>): Promise<string> {
    const res = await requestJson<{ data?: { id: string } }>(this.fetch, `${API}/tweets`, {
      stage: 'publish',
      what: 'X post',
      method: 'POST',
      headers: this.auth(account.accessToken),
      body: JSON.stringify(body),
    });
    if (!res.data?.id) throw new PublishError('ambiguous', 'X accepted the post but returned no ID');
    return res.data.id;
  }
}
