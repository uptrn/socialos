// Facebook Pages + Instagram (business accounts via Facebook Login, using the Page token).
// Docs (checked 2026-09-26):
//   Instagram: developers.facebook.com/docs/instagram-platform/content-publishing
//              .../instagram-graph-api/reference/ig-user/media
//   Pages:     developers.facebook.com/docs/pages-api/posts
//   FB Reels:  developers.facebook.com/docs/video-api/guides/reels-publishing

import { PublishError } from './errors';
import { request, requestJson, type FetchLike } from './http';
import type { AccountCredentials, PublishRequest, PublishResult, SocialAdapter } from './types';

interface MetaOptions {
  graphVersion: string; // e.g. v25.0
  fetch?: FetchLike;
}

abstract class MetaBase {
  protected readonly fetch: FetchLike;
  protected readonly graph: string;

  constructor(protected readonly opts: MetaOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.graph = `https://graph.facebook.com/${opts.graphVersion}`;
  }

  protected async post<T>(path: string, token: string, params: Record<string, string | undefined>, stage: 'prepare' | 'publish', what: string): Promise<T> {
    const body = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') body.set(k, v);
    return requestJson<T>(this.fetch, `${this.graph}/${path}`, { stage, what, method: 'POST', body });
  }

  protected async get<T>(path: string, token: string, fields: string, what: string): Promise<T> {
    const qs = new URLSearchParams({ fields, access_token: token });
    return requestJson<T>(this.fetch, `${this.graph}/${path}?${qs}`, { stage: 'prepare', what });
  }

  /** Best effort: a failed first comment never fails the post. */
  protected async firstComment(objectId: string, token: string, message: string | undefined) {
    if (!message?.trim()) return;
    try {
      await this.post(`${objectId}/comments`, token, { message }, 'prepare', 'First comment');
    } catch {
      // ignored: the post itself is live
    }
  }
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

/** "true" when any attached media was AI-generated, otherwise omitted. */
function aiFlag(req: PublishRequest): string | undefined {
  return req.media.some((m) => m.aiGenerated) ? 'true' : undefined;
}

type IgState =
  | { step: 'children'; children: string[] } // carousel items uploading
  | { step: 'container'; container: string }; // ready-to-publish container

const IG_POLL_SEC = 10;

export class InstagramAdapter extends MetaBase implements SocialAdapter {
  readonly platform = 'instagram' as const;

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const ig = account.externalAccountId;
    const token = account.accessToken;
    const o = req.options as { collaborators?: string[]; locationId?: string; shareReelToFeed?: boolean; thumbOffsetMs?: number };
    const common = {
      caption: req.caption || undefined,
      collaborators: o.collaborators?.length ? JSON.stringify(o.collaborators) : undefined,
      location_id: o.locationId,
      // Instagram's AI disclosure; for carousels it goes on the parent only (see resume()).
      is_ai_generated: aiFlag(req),
    };

    let container: string;
    switch (req.postType) {
      case 'image': {
        const m = req.media[0]!;
        container = (await this.post<{ id: string }>(`${ig}/media`, token, { ...common, image_url: m.url, alt_text: m.altText }, 'prepare', 'Instagram image container')).id;
        break;
      }
      case 'reel': {
        const m = req.media[0]!;
        container = (
          await this.post<{ id: string }>(
            `${ig}/media`,
            token,
            {
              ...common,
              media_type: 'REELS',
              video_url: m.url,
              share_to_feed: String(o.shareReelToFeed ?? true),
              thumb_offset: o.thumbOffsetMs !== undefined ? String(o.thumbOffsetMs) : undefined,
            },
            'prepare',
            'Instagram reel container',
          )
        ).id;
        break;
      }
      case 'story': {
        const m = req.media[0]!;
        container = (
          await this.post<{ id: string }>(
            `${ig}/media`,
            token,
            { media_type: 'STORIES', is_ai_generated: aiFlag(req), ...(m.kind === 'video' ? { video_url: m.url } : { image_url: m.url }) },
            'prepare',
            'Instagram story container',
          )
        ).id;
        break;
      }
      case 'carousel': {
        const children: string[] = [];
        for (const m of req.media) {
          const params =
            m.kind === 'video'
              ? { is_carousel_item: 'true', media_type: 'VIDEO', video_url: m.url }
              : { is_carousel_item: 'true', image_url: m.url, alt_text: m.altText };
          children.push((await this.post<{ id: string }>(`${ig}/media`, token, params, 'prepare', 'Instagram carousel item')).id);
        }
        return { status: 'processing', checkAfterSec: IG_POLL_SEC, resumeState: { step: 'children', children } satisfies IgState };
      }
      default:
        throw new PublishError('invalid_content', `Instagram does not support ${req.postType} posts`);
    }
    return { status: 'processing', checkAfterSec: IG_POLL_SEC, resumeState: { step: 'container', container } satisfies IgState };
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as IgState | undefined;
    const token = account.accessToken;
    const ig = account.externalAccountId;
    if (!state) throw new PublishError('permanent', 'Missing Instagram upload state');

    if (state.step === 'children') {
      const statuses = await Promise.all(state.children.map((id) => this.containerStatus(id, token)));
      if (statuses.some((s) => s === 'IN_PROGRESS')) return { status: 'processing', checkAfterSec: IG_POLL_SEC, resumeState: state };
      const o = req.options as { collaborators?: string[]; locationId?: string };
      const parent = await this.post<{ id: string }>(
        `${ig}/media`,
        token,
        {
          media_type: 'CAROUSEL',
          children: state.children.join(','),
          is_ai_generated: aiFlag(req),
          caption: req.caption || undefined,
          collaborators: o.collaborators?.length ? JSON.stringify(o.collaborators) : undefined,
          location_id: o.locationId,
        },
        'prepare',
        'Instagram carousel container',
      );
      return { status: 'processing', checkAfterSec: IG_POLL_SEC, resumeState: { step: 'container', container: parent.id } satisfies IgState };
    }

    const status = await this.containerStatus(state.container, token);
    if (status === 'IN_PROGRESS') return { status: 'processing', checkAfterSec: IG_POLL_SEC, resumeState: state };
    if (status === 'PUBLISHED') {
      // Already live (a previous publish call's response was lost). Don't publish again.
      throw new PublishError('ambiguous', 'Instagram reports this post as already published; check the account');
    }

    const media = await this.post<{ id: string }>(`${ig}/media_publish`, token, { creation_id: state.container }, 'publish', 'Instagram publish');
    const details = await this.get<{ permalink?: string }>(media.id, token, 'permalink', 'Instagram permalink').catch(() => ({ permalink: undefined }));
    await this.firstComment(media.id, token, (req.options as { firstComment?: string }).firstComment);
    return { status: 'published', externalPostId: media.id, url: details.permalink, publishedAt: new Date() };
  }

  private async containerStatus(id: string, token: string): Promise<string> {
    const { status_code, status } = await this.get<{ status_code: string; status?: string }>(id, token, 'status_code,status', 'Instagram container status');
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new PublishError('invalid_content', `Instagram could not process the media (${status_code}${status ? `: ${status}` : ''})`);
    }
    return status_code;
  }
}

// ---------------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------------

export class FacebookPageAdapter extends MetaBase implements SocialAdapter {
  readonly platform = 'facebook' as const;

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const page = account.externalAccountId;
    const token = account.accessToken;
    const o = req.options as { link?: string; firstComment?: string; videoTitle?: string };
    let postId: string;
    let url: string;

    switch (req.postType) {
      case 'text': {
        postId = (await this.post<{ id: string }>(`${page}/feed`, token, { message: req.caption, link: o.link }, 'publish', 'Facebook post')).id;
        url = `https://www.facebook.com/${postId}`;
        break;
      }
      case 'image': {
        if (req.media.length === 1) {
          const res = await this.post<{ id: string; post_id?: string }>(`${page}/photos`, token, { url: req.media[0]!.url, message: req.caption }, 'publish', 'Facebook photo post');
          postId = res.post_id ?? res.id;
        } else {
          // Upload photos unpublished, then attach them to one feed post.
          const ids: string[] = [];
          for (const m of req.media) {
            ids.push((await this.post<{ id: string }>(`${page}/photos`, token, { url: m.url, published: 'false' }, 'prepare', 'Facebook photo upload')).id);
          }
          const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
          postId = (await this.post<{ id: string }>(`${page}/feed`, token, { message: req.caption, ...attached }, 'publish', 'Facebook multi-photo post')).id;
        }
        url = `https://www.facebook.com/${postId}`;
        break;
      }
      case 'video': {
        const res = await this.post<{ id: string }>(
          `${page}/videos`,
          token,
          { file_url: req.media[0]!.url, description: req.caption, title: o.videoTitle },
          'publish',
          'Facebook video post',
        );
        postId = res.id;
        url = `https://www.facebook.com/${page}/videos/${postId}`;
        break;
      }
      case 'reel': {
        const start = await this.post<{ video_id: string }>(`${page}/video_reels`, token, { upload_phase: 'start' }, 'prepare', 'Facebook reel start');
        await request(this.fetch, `https://rupload.facebook.com/video-upload/${this.opts.graphVersion}/${start.video_id}`, {
          stage: 'prepare',
          what: 'Facebook reel upload',
          method: 'POST',
          headers: { Authorization: `OAuth ${token}`, file_url: req.media[0]!.url },
          timeoutMs: 180_000,
        });
        await this.post(`${page}/video_reels`, token, { video_id: start.video_id, upload_phase: 'finish', video_state: 'PUBLISHED', description: req.caption }, 'publish', 'Facebook reel publish');
        postId = start.video_id;
        url = `https://www.facebook.com/reel/${postId}`;
        break;
      }
      case 'story': {
        // Docs: developers.facebook.com/docs/page-stories-api
        const m = req.media[0]!;
        if (m.kind === 'image') {
          const photo = await this.post<{ id: string }>(`${page}/photos`, token, { url: m.url, published: 'false' }, 'prepare', 'Facebook story photo upload');
          const res = await this.post<{ post_id: string }>(`${page}/photo_stories`, token, { photo_id: photo.id }, 'publish', 'Facebook photo story');
          postId = res.post_id;
        } else {
          const start = await this.post<{ video_id: string }>(`${page}/video_stories`, token, { upload_phase: 'start' }, 'prepare', 'Facebook video story start');
          await request(this.fetch, `https://rupload.facebook.com/video-upload/${this.opts.graphVersion}/${start.video_id}`, {
            stage: 'prepare',
            what: 'Facebook video story upload',
            method: 'POST',
            headers: { Authorization: `OAuth ${token}`, file_url: m.url },
            timeoutMs: 180_000,
          });
          const res = await this.post<{ post_id: string }>(`${page}/video_stories`, token, { video_id: start.video_id, upload_phase: 'finish' }, 'publish', 'Facebook video story');
          postId = res.post_id;
        }
        url = `https://www.facebook.com/stories/${page}`;
        // Stories can't take comments.
        return { status: 'published', externalPostId: postId, url, publishedAt: new Date() };
      }
      default:
        throw new PublishError('invalid_content', `Facebook does not support ${req.postType} posts`);
    }

    await this.firstComment(postId, token, o.firstComment);
    return { status: 'published', externalPostId: postId, url, publishedAt: new Date() };
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    // Facebook publishing completes in one run; nothing to resume.
    throw new PublishError('permanent', 'Unexpected resume for a Facebook post');
  }
}
