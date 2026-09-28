// Reads and answers comments on the brand's published posts. Sources (checked 2026-09-27):
//  Facebook   GET /{post-id}/comments?filter=stream (pages_read_engagement, pages_read_user_content);
//             reply POST /{comment-id}/comments, hide POST /{comment-id} is_hidden (pages_manage_engagement)
//  Instagram  GET /{media-id}/comments with replies{...} expansion, max 50 per page (instagram_manage_comments);
//             reply POST /{comment-id}/replies, hide POST /{comment-id}?hide=true
//  Threads    GET /{media-id}/conversation (all depths, flattened) (threads_read_replies);
//             reply = text container with reply_to_id + threads_publish, hide POST /{reply-id}/manage_reply
//             (threads_manage_replies)
//  LinkedIn   GET/POST /rest/socialActions/{urn}/comments (r/w_organization_social_feed). Top-level comments
//             only; LinkedIn doesn't return commenter names to apps, so they show as "LinkedIn member".
//  YouTube    commentThreads.list / comments.insert (youtube.force-ssl)
//  X          GET /2/tweets/search/recent?query=conversation_id:… (last 7 days; uses paid API credits);
//             reply POST /2/tweets with reply.in_reply_to_tweet_id
//  TikTok     no comments API for this kind of app — not supported.
import { PublishError } from '../adapters/errors';
import { request, requestJson, type FetchLike } from '../adapters/http';
import type { AccountCredentials } from '../adapters/types';
import type { Platform, PostType } from '../platforms/types';

export interface InboxComment {
  externalId: string;
  /** The comment this one answers; null for a comment on the post itself. */
  parentExternalId: string | null;
  authorName: string;
  authorId: string | null;
  /** Written by the brand's own account (e.g. an earlier reply). */
  fromBrand: boolean;
  text: string;
  createdAt: Date;
  permalink?: string;
  hidden?: boolean;
}

export interface InboxPostRef {
  externalPostId: string;
  postType: PostType;
  publishedAt: Date;
}

export interface InboxConnector {
  platform: Platform;
  /** Whether comments can be hidden from the public through the API. */
  canHide: boolean;
  list(account: AccountCredentials, post: InboxPostRef): Promise<InboxComment[]>;
  /** Publishes a reply to a comment. Network failures are "ambiguous" (it may have been posted). */
  reply(account: AccountCredentials, post: InboxPostRef, parentExternalId: string, text: string): Promise<{ externalId: string }>;
  hide?(account: AccountCredentials, commentExternalId: string, hidden: boolean): Promise<void>;
}

export type InboxRegistry = Partial<Record<Platform, InboxConnector>>;

export const INBOX_PLATFORMS: Platform[] = ['facebook', 'instagram', 'threads', 'linkedin', 'youtube', 'x'];

/** Most comments read per post per sync (newest first where the platform allows). */
const MAX_PER_POST = 200;

// ---------------------------------------------------------------------------
// Sync schedule: often while a post is fresh, then less, then stop.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;

export function nextInboxSyncAt(publishedAt: Date, now: Date): Date | null {
  const age = now.getTime() - publishedAt.getTime();
  if (age < 48 * HOUR) return new Date(now.getTime() + 15 * MIN);
  if (age < 7 * 24 * HOUR) return new Date(now.getTime() + HOUR);
  if (age < 30 * 24 * HOUR) return new Date(now.getTime() + 6 * HOUR);
  return null;
}

/** A comment that asks something (shown as "Question"). */
export function looksLikeQuestion(text: string): boolean {
  return /\?\s*$|\?\s|^(how|what|when|where|why|who|which|can|could|do|does|is|are|will|would)\b/i.test(text.trim());
}

// ---------------------------------------------------------------------------

function form(params: Record<string, string>) {
  return new URLSearchParams(params);
}

export class FacebookInbox implements InboxConnector {
  readonly platform = 'facebook' as const;
  readonly canHide = true;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { graphVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }
  private url(path: string) {
    return `https://graph.facebook.com/${this.opts.graphVersion}/${path}`;
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    const out: InboxComment[] = [];
    let next: string | undefined = `${this.url(`${post.externalPostId}/comments`)}?${form({
      filter: 'stream',
      order: 'reverse_chronological',
      fields: 'id,message,from{id,name},created_time,parent{id},is_hidden,permalink_url',
      limit: '100',
      access_token: account.accessToken,
    })}`;
    while (next && out.length < MAX_PER_POST) {
      const page: { data: { id: string; message?: string; from?: { id: string; name: string }; created_time: string; parent?: { id: string }; is_hidden?: boolean; permalink_url?: string }[]; paging?: { next?: string } } =
        await requestJson(this.fetchImpl, next, { stage: 'prepare', what: 'Facebook comments' });
      for (const c of page.data) {
        out.push({
          externalId: c.id,
          parentExternalId: c.parent?.id ?? null,
          authorName: c.from?.name ?? 'Facebook user',
          authorId: c.from?.id ?? null,
          fromBrand: c.from?.id === account.externalAccountId,
          text: c.message ?? '',
          createdAt: new Date(c.created_time),
          permalink: c.permalink_url,
          hidden: c.is_hidden,
        });
      }
      next = page.paging?.next;
    }
    return out;
  }

  async reply(account: AccountCredentials, _post: InboxPostRef, parent: string, text: string) {
    const res = await requestJson<{ id: string }>(this.fetchImpl, this.url(`${parent}/comments`), {
      stage: 'publish',
      what: 'Facebook reply',
      method: 'POST',
      body: form({ message: text, access_token: account.accessToken }),
    });
    return { externalId: res.id };
  }

  async hide(account: AccountCredentials, commentId: string, hidden: boolean) {
    await request(this.fetchImpl, this.url(commentId), { stage: 'prepare', what: 'Facebook hide comment', method: 'POST', body: form({ is_hidden: String(hidden), access_token: account.accessToken }) });
  }
}

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  from?: { id: string; username?: string };
  timestamp: string;
  hidden?: boolean;
  replies?: { data: IgComment[] };
}

export class InstagramInbox implements InboxConnector {
  readonly platform = 'instagram' as const;
  readonly canHide = true;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { graphVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }
  private url(path: string) {
    return `https://graph.facebook.com/${this.opts.graphVersion}/${path}`;
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    if (post.postType === 'story') return []; // stories have no comments (replies are DMs)
    const fields = 'id,text,username,from{id,username},timestamp,hidden';
    const out: InboxComment[] = [];
    const add = (c: IgComment, parent: string | null) =>
      out.push({
        externalId: c.id,
        parentExternalId: parent,
        authorName: c.username ?? c.from?.username ?? 'Instagram user',
        authorId: c.from?.id ?? null,
        fromBrand: c.from?.id === account.externalAccountId,
        text: c.text ?? '',
        createdAt: new Date(c.timestamp),
        hidden: c.hidden,
      });
    let next: string | undefined = `${this.url(`${post.externalPostId}/comments`)}?${form({ fields: `${fields},replies{${fields}}`, limit: '50', access_token: account.accessToken })}`;
    while (next && out.length < MAX_PER_POST) {
      const page: { data: IgComment[]; paging?: { next?: string } } = await requestJson(this.fetchImpl, next, { stage: 'prepare', what: 'Instagram comments' });
      for (const c of page.data) {
        add(c, null);
        for (const r of c.replies?.data ?? []) add(r, c.id);
      }
      next = page.paging?.next;
    }
    return out;
  }

  async reply(account: AccountCredentials, _post: InboxPostRef, parent: string, text: string) {
    const res = await requestJson<{ id: string }>(this.fetchImpl, this.url(`${parent}/replies`), {
      stage: 'publish',
      what: 'Instagram reply',
      method: 'POST',
      body: form({ message: text, access_token: account.accessToken }),
    });
    return { externalId: res.id };
  }

  async hide(account: AccountCredentials, commentId: string, hidden: boolean) {
    await request(this.fetchImpl, this.url(commentId), { stage: 'prepare', what: 'Instagram hide comment', method: 'POST', body: form({ hide: String(hidden), access_token: account.accessToken }) });
  }
}

export class ThreadsInbox implements InboxConnector {
  readonly platform = 'threads' as const;
  readonly canHide = true;
  private readonly fetchImpl: FetchLike;
  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    const out: InboxComment[] = [];
    let next: string | undefined = `https://graph.threads.net/v1.0/${post.externalPostId}/conversation?${form({
      fields: 'id,text,username,timestamp,permalink,is_reply_owned_by_me,hide_status,replied_to',
      reverse: 'true',
      access_token: account.accessToken,
    })}`;
    while (next && out.length < MAX_PER_POST) {
      const page: { data: { id: string; text?: string; username?: string; timestamp: string; permalink?: string; is_reply_owned_by_me?: boolean; hide_status?: string; replied_to?: { id: string } }[]; paging?: { next?: string } } =
        await requestJson(this.fetchImpl, next, { stage: 'prepare', what: 'Threads replies' });
      for (const r of page.data) {
        const parent = r.replied_to?.id;
        out.push({
          externalId: r.id,
          parentExternalId: parent && parent !== post.externalPostId ? parent : null,
          authorName: r.username ?? 'Threads user',
          authorId: null,
          fromBrand: r.is_reply_owned_by_me === true,
          text: r.text ?? '',
          createdAt: new Date(r.timestamp),
          permalink: r.permalink,
          hidden: r.hide_status === 'HIDDEN',
        });
      }
      next = page.paging?.next;
    }
    return out;
  }

  async reply(account: AccountCredentials, _post: InboxPostRef, parent: string, text: string) {
    const user = account.externalAccountId;
    const container = await requestJson<{ id: string }>(this.fetchImpl, `https://graph.threads.net/v1.0/${user}/threads`, {
      stage: 'prepare',
      what: 'Threads reply container',
      method: 'POST',
      body: form({ media_type: 'TEXT', text, reply_to_id: parent, access_token: account.accessToken }),
    });
    const res = await requestJson<{ id: string }>(this.fetchImpl, `https://graph.threads.net/v1.0/${user}/threads_publish`, {
      stage: 'publish',
      what: 'Threads reply',
      method: 'POST',
      body: form({ creation_id: container.id, access_token: account.accessToken }),
    });
    return { externalId: res.id };
  }

  async hide(account: AccountCredentials, replyId: string, hidden: boolean) {
    await request(this.fetchImpl, `https://graph.threads.net/v1.0/${replyId}/manage_reply`, {
      stage: 'prepare',
      what: 'Threads hide reply',
      method: 'POST',
      body: form({ hide: String(hidden), access_token: account.accessToken }),
    });
  }
}

export class LinkedInInbox implements InboxConnector {
  readonly platform = 'linkedin' as const;
  readonly canHide = false;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { apiVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }
  private headers(token: string) {
    return { Authorization: `Bearer ${token}`, 'Linkedin-Version': this.opts.apiVersion, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    const res = await requestJson<{ elements?: { actor: string; commentUrn?: string; id: string; created?: { time: number }; message?: { text?: string }; parentComment?: string }[] }>(
      this.fetchImpl,
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(post.externalPostId)}/comments?count=100`,
      { stage: 'prepare', what: 'LinkedIn comments', headers: this.headers(account.accessToken) },
    );
    return (res.elements ?? []).map((c) => ({
      // The comment URN is what replies need as parentComment.
      externalId: c.commentUrn ?? c.id,
      parentExternalId: c.parentComment ?? null,
      authorName: c.actor === account.externalAccountId ? 'Your page' : c.actor.startsWith('urn:li:organization:') ? 'LinkedIn page' : 'LinkedIn member',
      authorId: c.actor,
      fromBrand: c.actor === account.externalAccountId,
      text: c.message?.text ?? '',
      createdAt: new Date(c.created?.time ?? Date.now()),
    }));
  }

  async reply(account: AccountCredentials, post: InboxPostRef, parentCommentUrn: string, text: string) {
    const res = await request(this.fetchImpl, `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(parentCommentUrn)}/comments`, {
      stage: 'publish',
      what: 'LinkedIn reply',
      method: 'POST',
      headers: this.headers(account.accessToken),
      body: JSON.stringify({ actor: account.externalAccountId, object: post.externalPostId, message: { text }, parentComment: parentCommentUrn }),
    });
    const body = (await res.json().catch(() => ({}))) as { commentUrn?: string };
    const id = body.commentUrn ?? res.headers.get('x-restli-id');
    if (!id) throw new PublishError('ambiguous', 'LinkedIn accepted the reply but returned no id');
    return { externalId: id };
  }
}

export class YouTubeInbox implements InboxConnector {
  readonly platform = 'youtube' as const;
  readonly canHide = false;
  private readonly fetchImpl: FetchLike;
  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    interface Snippet { authorDisplayName?: string; authorChannelId?: { value?: string }; textOriginal?: string; publishedAt: string; parentId?: string }
    const out: InboxComment[] = [];
    const add = (id: string, s: Snippet, parent: string | null) =>
      out.push({
        externalId: id,
        parentExternalId: parent,
        authorName: s.authorDisplayName ?? 'YouTube user',
        authorId: s.authorChannelId?.value ?? null,
        fromBrand: s.authorChannelId?.value === account.externalAccountId,
        text: s.textOriginal ?? '',
        createdAt: new Date(s.publishedAt),
        permalink: `https://www.youtube.com/watch?v=${post.externalPostId}&lc=${id}`,
      });
    let pageToken: string | undefined;
    do {
      const qs = form({ part: 'snippet,replies', videoId: post.externalPostId, maxResults: '100', order: 'time', textFormat: 'plainText', ...(pageToken ? { pageToken } : {}) });
      const res: { items?: { id: string; snippet: { topLevelComment: { id: string; snippet: Snippet } }; replies?: { comments: { id: string; snippet: Snippet }[] } }[]; nextPageToken?: string } =
        await requestJson(this.fetchImpl, `https://www.googleapis.com/youtube/v3/commentThreads?${qs}`, { stage: 'prepare', what: 'YouTube comments', headers: { Authorization: `Bearer ${account.accessToken}` } });
      for (const t of res.items ?? []) {
        const top = t.snippet.topLevelComment;
        add(top.id, top.snippet, null);
        for (const r of t.replies?.comments ?? []) add(r.id, r.snippet, top.id);
      }
      pageToken = res.nextPageToken;
    } while (pageToken && out.length < MAX_PER_POST);
    return out;
  }

  async reply(account: AccountCredentials, _post: InboxPostRef, parent: string, text: string) {
    const res = await requestJson<{ id: string }>(this.fetchImpl, 'https://www.googleapis.com/youtube/v3/comments?part=snippet', {
      stage: 'publish',
      what: 'YouTube reply',
      method: 'POST',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId: parent, textOriginal: text } }),
    });
    return { externalId: res.id };
  }
}

export class XInbox implements InboxConnector {
  readonly platform = 'x' as const;
  readonly canHide = false;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  constructor(opts: { fetch?: FetchLike; now?: () => Date } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  async list(account: AccountCredentials, post: InboxPostRef) {
    // Recent search only covers the last 7 days.
    if (this.now().getTime() - post.publishedAt.getTime() > 7 * 24 * HOUR) return [];
    const qs = form({
      query: `conversation_id:${post.externalPostId}`,
      'tweet.fields': 'author_id,created_at,referenced_tweets',
      expansions: 'author_id',
      'user.fields': 'username,name',
      max_results: '100',
    });
    const res = await requestJson<{ data?: { id: string; text: string; author_id: string; created_at: string; referenced_tweets?: { type: string; id: string }[] }[]; includes?: { users?: { id: string; username: string; name: string }[] } }>(
      this.fetchImpl,
      `https://api.x.com/2/tweets/search/recent?${qs}`,
      { stage: 'prepare', what: 'X replies', headers: { Authorization: `Bearer ${account.accessToken}` } },
    );
    const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
    return (res.data ?? []).map((t) => {
      const parent = t.referenced_tweets?.find((r) => r.type === 'replied_to')?.id ?? null;
      const u = users.get(t.author_id);
      return {
        externalId: t.id,
        parentExternalId: parent && parent !== post.externalPostId ? parent : null,
        authorName: u ? `${u.name} (@${u.username})` : 'X user',
        authorId: t.author_id,
        fromBrand: t.author_id === account.externalAccountId,
        text: t.text,
        createdAt: new Date(t.created_at),
        permalink: `https://x.com/i/web/status/${t.id}`,
      };
    });
  }

  async reply(account: AccountCredentials, _post: InboxPostRef, parent: string, text: string) {
    const res = await requestJson<{ data: { id: string } }>(this.fetchImpl, 'https://api.x.com/2/tweets', {
      stage: 'publish',
      what: 'X reply',
      method: 'POST',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: parent } }),
    });
    return { externalId: res.data.id };
  }
}

/** Simulated comments for mock accounts: a few per post, arriving over the first hours. */
export class MockInbox implements InboxConnector {
  readonly canHide = true;
  private static counter = 0;
  constructor(readonly platform: Platform, private readonly now: () => Date = () => new Date()) {}

  async list(_account: AccountCredentials, post: InboxPostRef) {
    const samples = [
      ['Priya S.', 'How much does this cost for a team of 5?'],
      ['Marco', 'Love this, been waiting for it!'],
      ['Dana K.', 'Does it work with QuickBooks?'],
      ['Sam', 'The link in your post is broken for me.'],
    ] as const;
    let h = 0;
    for (const c of post.externalPostId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const ageMin = (this.now().getTime() - post.publishedAt.getTime()) / MIN;
    return samples
      .slice(0, 1 + (h % samples.length))
      .map(([name, text], i) => ({ i, name, text, at: 20 + i * 45 }))
      .filter((c) => ageMin >= c.at)
      .map((c) => ({
        externalId: `mockc_${post.externalPostId}_${c.i}`,
        parentExternalId: null,
        authorName: c.name,
        authorId: null,
        fromBrand: false,
        text: c.text,
        createdAt: new Date(post.publishedAt.getTime() + c.at * MIN),
      }));
  }

  async reply() {
    MockInbox.counter += 1;
    return { externalId: `mockr_${Date.now()}_${MockInbox.counter}` };
  }

  async hide() {}
}
