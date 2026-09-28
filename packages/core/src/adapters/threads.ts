// Threads API. Docs (checked 2026-09-26): developers.facebook.com/docs/threads/posts
// Containers need processing time before publishing (Meta recommends ~30s on average).

import { PublishError } from './errors';
import { requestJson, type FetchLike } from './http';
import type { AccountCredentials, PublishRequest, PublishResult, SocialAdapter } from './types';

const HOST = 'https://graph.threads.net/v1.0';
const POLL_SEC = 15;

interface ThreadsOptions {
  fetch?: FetchLike;
}

type ThreadsState =
  | { step: 'children'; children: string[] }
  | {
      step: 'container';
      container: string;
      /** Index of the thread part this container is for; -1 = the main post. */
      part: number;
      rootId?: string;
      lastId?: string;
    };

export class ThreadsAdapter implements SocialAdapter {
  readonly platform = 'threads' as const;
  private readonly fetch: FetchLike;

  constructor(opts: ThreadsOptions = {}) {
    this.fetch = opts.fetch ?? fetch;
  }

  private post<T>(path: string, token: string, params: Record<string, string | undefined>, stage: 'prepare' | 'publish', what: string) {
    const body = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') body.set(k, v);
    return requestJson<T>(this.fetch, `${HOST}/${path}`, { stage, what, method: 'POST', body });
  }

  private get<T>(path: string, token: string, fields: string, what: string) {
    return requestJson<T>(this.fetch, `${HOST}/${path}?${new URLSearchParams({ fields, access_token: token })}`, { stage: 'prepare', what });
  }

  async publish(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const user = account.externalAccountId;
    const token = account.accessToken;
    const replyControl = (req.options as { replyControl?: string }).replyControl;

    if (req.postType === 'carousel') {
      const children: string[] = [];
      for (const m of req.media) {
        const params = m.kind === 'video' ? { media_type: 'VIDEO', video_url: m.url } : { media_type: 'IMAGE', image_url: m.url };
        children.push((await this.post<{ id: string }>(`${user}/threads`, token, { ...params, is_carousel_item: 'true' }, 'prepare', 'Threads carousel item')).id);
      }
      return { status: 'processing', checkAfterSec: POLL_SEC, resumeState: { step: 'children', children } satisfies ThreadsState };
    }

    const m = req.media[0];
    const params =
      req.postType === 'text'
        ? { media_type: 'TEXT' }
        : req.postType === 'image'
          ? { media_type: 'IMAGE', image_url: m!.url, alt_text: m!.altText }
          : req.postType === 'video'
            ? { media_type: 'VIDEO', video_url: m!.url, alt_text: m!.altText }
            : null;
    if (!params) throw new PublishError('invalid_content', `Threads does not support ${req.postType} posts`);

    const container = await this.post<{ id: string }>(`${user}/threads`, token, { ...params, text: req.caption, reply_control: replyControl }, 'prepare', 'Threads container');
    return { status: 'processing', checkAfterSec: req.postType === 'text' ? 5 : POLL_SEC, resumeState: { step: 'container', container: container.id, part: -1 } satisfies ThreadsState };
  }

  async resume(account: AccountCredentials, req: PublishRequest): Promise<PublishResult> {
    const state = req.resumeState as ThreadsState | undefined;
    const user = account.externalAccountId;
    const token = account.accessToken;
    if (!state) throw new PublishError('permanent', 'Missing Threads state');
    const replyControl = (req.options as { replyControl?: string }).replyControl;

    if (state.step === 'children') {
      const statuses = await Promise.all(state.children.map((id) => this.status(id, token)));
      if (statuses.some((s) => s === 'IN_PROGRESS')) return { status: 'processing', checkAfterSec: POLL_SEC, resumeState: state };
      const parent = await this.post<{ id: string }>(
        `${user}/threads`, token,
        { media_type: 'CAROUSEL', children: state.children.join(','), text: req.caption, reply_control: replyControl },
        'prepare', 'Threads carousel',
      );
      return { status: 'processing', checkAfterSec: POLL_SEC, resumeState: { step: 'container', container: parent.id, part: -1 } };
    }

    const isMain = state.part === -1;
    try {
      const status = await this.status(state.container, token);
      if (status === 'IN_PROGRESS') return { status: 'processing', checkAfterSec: POLL_SEC, resumeState: state };
      if (status === 'PUBLISHED') throw new PublishError('ambiguous', 'Threads reports this post as already published; check the account');

      const published = await this.post<{ id: string }>(`${user}/threads_publish`, token, { creation_id: state.container }, 'publish', 'Threads publish');
      const rootId = state.rootId ?? published.id;

      // Next thread part replies to the post just published.
      const parts = (req.threadParts ?? []).filter((p) => p.trim());
      const next = state.part + 1;
      if (next < parts.length) {
        const container = await this.post<{ id: string }>(
          `${user}/threads`, token,
          { media_type: 'TEXT', text: parts[next], reply_to_id: published.id, reply_control: replyControl },
          'prepare', 'Threads reply container',
        );
        return { status: 'processing', checkAfterSec: 5, resumeState: { step: 'container', container: container.id, part: next, rootId, lastId: published.id } };
      }
      return this.done(rootId, token);
    } catch (e) {
      // Once the main post is live, a failing reply must not fail (or re-publish) the whole job.
      if (isMain || !state.rootId) throw e;
      return this.done(state.rootId, token, `Thread stopped at post ${state.part + 2}: ${(e as Error).message}`);
    }
  }

  private async done(rootId: string, token: string, warning?: string): Promise<PublishResult> {
    const details = await this.get<{ permalink?: string }>(rootId, token, 'permalink', 'Threads permalink').catch(() => ({ permalink: undefined }));
    return { status: 'published', externalPostId: rootId, url: details.permalink, publishedAt: new Date(), warning };
  }

  private async status(id: string, token: string): Promise<string> {
    const { status, error_message } = await this.get<{ status: string; error_message?: string }>(id, token, 'status,error_message', 'Threads container status');
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new PublishError('invalid_content', `Threads could not process the media (${status}${error_message ? `: ${error_message}` : ''})`);
    }
    return status;
  }
}
