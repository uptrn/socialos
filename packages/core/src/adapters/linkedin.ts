// LinkedIn organization posting. Docs (verified 2026-09-26):
//   Posts:     learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
//   Images:    .../shares/images-api      MultiImage: .../shares/multiimage-post-api
//   Videos:    .../shares/videos-api      Documents:  .../shares/documents-api

import { PublishError } from './errors';
import { request, requestJson, type FetchLike } from './http';
import type { AccountCredentials, PublishMedia, PublishRequest, PublishResult, SocialAdapter } from './types';

const API = 'https://api.linkedin.com/rest';
const PROCESSING_POLL_SEC = 20;

interface LinkedInOptions {
  apiVersion: string; // YYYYMM
  fetch?: FetchLike;
}

type ResumeState = { kind: 'video' | 'document'; urn: string };

export class LinkedInAdapter implements SocialAdapter {
  readonly platform = 'linkedin' as const;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: LinkedInOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  private headers(token: string, json = true): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Linkedin-Version': this.opts.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const token = account.accessToken;
    const owner = account.externalAccountId; // urn:li:organization:{id}

    switch (req.postType) {
      case 'text':
        return this.createPost(token, owner, req, undefined);

      case 'image': {
        const images = [];
        for (const m of req.media) images.push({ id: await this.uploadImage(token, owner, m), altText: m.altText });
        const content =
          images.length === 1
            ? { media: { id: images[0]!.id, ...(images[0]!.altText ? { altText: images[0]!.altText } : {}) } }
            : { multiImage: { images: images.map((i) => ({ id: i.id, ...(i.altText ? { altText: i.altText } : {}) })) } };
        return this.createPost(token, owner, req, content);
      }

      case 'video': {
        const urn = await this.uploadVideo(token, owner, req.media[0]!);
        return { status: 'processing', checkAfterSec: PROCESSING_POLL_SEC, resumeState: { kind: 'video', urn } satisfies ResumeState };
      }

      case 'document': {
        const urn = await this.uploadDocument(token, owner, req.media[0]!);
        return { status: 'processing', checkAfterSec: PROCESSING_POLL_SEC, resumeState: { kind: 'document', urn } satisfies ResumeState };
      }

      default:
        throw new PublishError('invalid_content', `LinkedIn does not support ${req.postType} posts`);
    }
  }

  /** Waits for uploaded video/document processing, then creates the post. */
  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as ResumeState | undefined;
    if (!state?.urn) throw new PublishError('permanent', 'Missing LinkedIn upload state');
    const token = account.accessToken;

    const path = state.kind === 'video' ? 'videos' : 'documents';
    const asset = await requestJson<{ status: string; processingFailureReason?: string }>(
      this.fetch,
      `${API}/${path}/${encodeURIComponent(state.urn)}`,
      { stage: 'prepare', what: `LinkedIn ${state.kind} status`, headers: this.headers(token, false) },
    );
    if (asset.status === 'PROCESSING_FAILED') {
      throw new PublishError('invalid_content', `LinkedIn could not process the ${state.kind}${asset.processingFailureReason ? `: ${asset.processingFailureReason}` : ''}`);
    }
    if (asset.status !== 'AVAILABLE') {
      return { status: 'processing', checkAfterSec: PROCESSING_POLL_SEC, resumeState: state };
    }

    const title =
      state.kind === 'document'
        ? (req.options as { documentTitle?: string }).documentTitle || 'Document'
        : undefined;
    return this.createPost(token, account.externalAccountId, req, { media: { id: state.urn, ...(title ? { title } : {}) } });
  }

  private async createPost(token: string, author: string, req: PublishRequest, content: unknown): Promise<PublishResult> {
    const visibility = (req.options as { visibility?: string }).visibility ?? 'PUBLIC';
    const res = await request(this.fetch, `${API}/posts`, {
      stage: 'publish',
      what: 'LinkedIn post',
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        author,
        commentary: escapeLittleText(req.caption),
        visibility,
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
    const postUrn = res.headers.get('x-restli-id');
    if (!postUrn) throw new PublishError('ambiguous', 'LinkedIn accepted the post but returned no post ID');
    return {
      status: 'published',
      externalPostId: postUrn,
      url: `https://www.linkedin.com/feed/update/${postUrn}/`,
      publishedAt: new Date(),
    };
  }

  private async uploadImage(token: string, owner: string, media: PublishMedia): Promise<string> {
    const init = await requestJson<{ value: { uploadUrl: string; image: string } }>(this.fetch, `${API}/images?action=initializeUpload`, {
      stage: 'prepare',
      what: 'LinkedIn image upload init',
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    const bytes = await this.download(media.url, 'image');
    await request(this.fetch, init.value.uploadUrl, {
      stage: 'prepare',
      what: 'LinkedIn image upload',
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': media.mimeType },
      body: bytes,
    });
    return init.value.image;
  }

  private async uploadDocument(token: string, owner: string, media: PublishMedia): Promise<string> {
    const init = await requestJson<{ value: { uploadUrl: string; document: string } }>(this.fetch, `${API}/documents?action=initializeUpload`, {
      stage: 'prepare',
      what: 'LinkedIn document upload init',
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    const bytes = await this.download(media.url, 'document');
    await request(this.fetch, init.value.uploadUrl, {
      stage: 'prepare',
      what: 'LinkedIn document upload',
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: bytes,
    });
    return init.value.document;
  }

  /** Multi-part upload: LinkedIn returns ~4 MB byte ranges; each part's ETag is needed to finalize. */
  private async uploadVideo(token: string, owner: string, media: PublishMedia): Promise<string> {
    const init = await requestJson<{
      value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
    }>(this.fetch, `${API}/videos?action=initializeUpload`, {
      stage: 'prepare',
      what: 'LinkedIn video upload init',
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        initializeUploadRequest: { owner, fileSizeBytes: media.sizeBytes, uploadCaptions: false, uploadThumbnail: false },
      }),
    });

    const etags: string[] = [];
    for (const part of init.value.uploadInstructions) {
      // Ranged read from storage so large videos are never held in memory at once.
      const chunk = await this.download(media.url, 'video part', `bytes=${part.firstByte}-${part.lastByte}`);
      const res = await request(this.fetch, part.uploadUrl, {
        stage: 'prepare',
        what: 'LinkedIn video part upload',
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
        timeoutMs: 120_000,
      });
      const etag = res.headers.get('etag');
      if (!etag) throw new PublishError('transient', 'LinkedIn video part upload returned no ETag');
      etags.push(etag);
    }

    await request(this.fetch, `${API}/videos?action=finalizeUpload`, {
      stage: 'prepare',
      what: 'LinkedIn video finalize',
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? '', uploadedPartIds: etags } }),
    });
    return init.value.video;
  }

  private async download(url: string, what: string, range?: string): Promise<ArrayBuffer> {
    const res = await request(this.fetch, url, {
      stage: 'prepare',
      what: `Reading ${what} from storage`,
      headers: range ? { Range: range } : undefined,
      timeoutMs: 120_000,
    });
    return res.arrayBuffer();
  }
}

/**
 * LinkedIn commentary uses "little text" format. Reserved characters (| { } @ [ ] ( ) < > # \ * _ ~)
 * must be backslash-escaped to stay literal, except a '#' that starts a word, which LinkedIn
 * turns into a hashtag. Docs: .../community-management/shares/little-text-format
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]|#(?![\p{L}\p{N}_])/gu, (c) => `\\${c}`);
}
