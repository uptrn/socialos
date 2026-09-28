import { describe, expect, it } from 'vitest';
import {
  FacebookInbox,
  InstagramInbox,
  LinkedInInbox,
  looksLikeQuestion,
  MockInbox,
  nextInboxSyncAt,
  replyUserPrompt,
  ThreadsInbox,
  XInbox,
  YouTubeInbox,
  type AccountCredentials,
  type InboxPostRef,
} from '../src';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const acct = (id: string, platform: AccountCredentials['platform']): AccountCredentials => ({ socialAccountId: 'a', platform, externalAccountId: id, accessToken: 'T' });
const T0 = new Date('2026-09-20T10:00:00Z');
const post = (id: string, over: Partial<InboxPostRef> = {}): InboxPostRef => ({ externalPostId: id, postType: 'image', publishedAt: T0, ...over });
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function fakeFetch(responses: ((url: string, init?: RequestInit) => Response)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected call ${String(input)}`);
    return next(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

describe('inbox schedule and helpers', () => {
  it('syncs every 15 min for 2 days, hourly for a week, every 6 h for a month, then stops', () => {
    expect(nextInboxSyncAt(T0, hours(1))).toEqual(new Date(hours(1).getTime() + 15 * 60_000));
    expect(nextInboxSyncAt(T0, hours(72))).toEqual(hours(73));
    expect(nextInboxSyncAt(T0, hours(24 * 10))).toEqual(hours(24 * 10 + 6));
    expect(nextInboxSyncAt(T0, hours(24 * 31))).toBeNull();
  });

  it('spots questions', () => {
    expect(looksLikeQuestion('How much is it')).toBe(true);
    expect(looksLikeQuestion('Nice work? maybe')).toBe(true);
    expect(looksLikeQuestion('Love this!')).toBe(false);
  });

  it('builds the reply prompt with the thread', () => {
    const p = replyUserPrompt({
      platformLabel: 'Instagram',
      postCaption: 'Launch day',
      thread: [
        { author: 'Ann', text: 'Is it free?', fromBrand: false },
        { author: 'Acme', text: 'There is a trial', fromBrand: true },
      ],
      comment: { author: 'Ann', text: 'How long?' },
    });
    expect(p).toContain('- Ann: "Is it free?"');
    expect(p).toContain('- Brand: "There is a trial"');
    expect(p).toContain('from Ann');
  });
});

describe('connectors', () => {
  it('Facebook lists all comments with parents, marks the page as brand, and pages through', async () => {
    const f = fakeFetch([
      () => json({ data: [{ id: 'c1', message: 'Hi?', from: { id: 'u1', name: 'Ann' }, created_time: '2026-09-20T11:00:00+0000' }], paging: { next: 'https://graph.facebook.com/next' } }),
      () => json({ data: [{ id: 'c2', message: 'Thanks!', from: { id: 'PAGE', name: 'Acme' }, created_time: '2026-09-20T12:00:00+0000', parent: { id: 'c1' } }] }),
    ]);
    const out = await new FacebookInbox({ graphVersion: 'v25.0', fetch: f.impl }).list(acct('PAGE', 'facebook'), post('PAGE_1'));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ externalId: 'c1', parentExternalId: null, authorName: 'Ann', fromBrand: false });
    expect(out[1]).toMatchObject({ externalId: 'c2', parentExternalId: 'c1', fromBrand: true });
    expect(f.calls[0]!.url).toContain('/PAGE_1/comments?filter=stream');
  });

  it('Instagram flattens replies and skips stories', async () => {
    const f = fakeFetch([
      () =>
        json({
          data: [
            {
              id: 'c1',
              text: 'Price?',
              username: 'ann',
              from: { id: 'u1' },
              timestamp: '2026-09-20T11:00:00+0000',
              replies: { data: [{ id: 'r1', text: 'DM us', username: 'acme', from: { id: 'IG' }, timestamp: '2026-09-20T11:05:00+0000' }] },
            },
          ],
        }),
    ]);
    const ig = new InstagramInbox({ graphVersion: 'v25.0', fetch: f.impl });
    const out = await ig.list(acct('IG', 'instagram'), post('m1'));
    expect(out.map((c) => [c.externalId, c.parentExternalId, c.fromBrand])).toEqual([
      ['c1', null, false],
      ['r1', 'c1', true],
    ]);
    expect(await ig.list(acct('IG', 'instagram'), post('m2', { postType: 'story' }))).toEqual([]);
  });

  it('Threads replies to a reply with a container then publish', async () => {
    const f = fakeFetch([() => json({ id: 'container' }), () => json({ id: 'published' })]);
    const res = await new ThreadsInbox({ fetch: f.impl }).reply(acct('TU', 'threads'), post('p'), 'r1', 'Thanks!');
    expect(res.externalId).toBe('published');
    expect(String(f.calls[0]!.init?.body)).toContain('reply_to_id=r1');
    expect(f.calls[1]!.url).toContain('/TU/threads_publish');
  });

  it('Threads maps the conversation and treats replies to the post as top level', async () => {
    const f = fakeFetch([
      () =>
        json({
          data: [
            { id: 'r1', text: 'Cool', username: 'ann', timestamp: '2026-09-20T11:00:00+0000', replied_to: { id: 'P' } },
            { id: 'r2', text: 'Thanks', username: 'acme', timestamp: '2026-09-20T11:10:00+0000', replied_to: { id: 'r1' }, is_reply_owned_by_me: true },
          ],
        }),
    ]);
    const out = await new ThreadsInbox({ fetch: f.impl }).list(acct('TU', 'threads'), post('P'));
    expect(out.map((c) => [c.parentExternalId, c.fromBrand])).toEqual([
      [null, false],
      ['r1', true],
    ]);
  });

  it('LinkedIn replies as the organization with the parent comment URN', async () => {
    const f = fakeFetch([() => json({ commentUrn: 'urn:li:comment:(urn:li:activity:1,99)' }, 201)]);
    const parent = 'urn:li:comment:(urn:li:activity:1,5)';
    const res = await new LinkedInInbox({ apiVersion: '202609', fetch: f.impl }).reply(acct('urn:li:organization:42', 'linkedin'), post('urn:li:share:1'), parent, 'Thanks');
    expect(res.externalId).toBe('urn:li:comment:(urn:li:activity:1,99)');
    expect(f.calls[0]!.url).toContain(`/socialActions/${encodeURIComponent(parent)}/comments`);
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({ actor: 'urn:li:organization:42', object: 'urn:li:share:1', message: { text: 'Thanks' }, parentComment: parent });
  });

  it('YouTube lists threads with replies', async () => {
    const f = fakeFetch([
      () =>
        json({
          items: [
            {
              id: 't1',
              snippet: { topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'Ann', authorChannelId: { value: 'UCann' }, textOriginal: 'Great', publishedAt: '2026-09-20T11:00:00Z' } } },
              replies: { comments: [{ id: 'c1.r', snippet: { authorDisplayName: 'Acme', authorChannelId: { value: 'UCme' }, textOriginal: 'Thanks', publishedAt: '2026-09-20T12:00:00Z' } }] },
            },
          ],
        }),
    ]);
    const out = await new YouTubeInbox({ fetch: f.impl }).list(acct('UCme', 'youtube'), post('vid'));
    expect(out.map((c) => [c.externalId, c.parentExternalId, c.fromBrand])).toEqual([
      ['c1', null, false],
      ['c1.r', 'c1', true],
    ]);
  });

  it('X only searches the last 7 days and maps authors', async () => {
    const f = fakeFetch([
      () =>
        json({
          data: [{ id: '2', text: '@acme when?', author_id: 'u9', created_at: '2026-09-20T11:00:00.000Z', referenced_tweets: [{ type: 'replied_to', id: '1' }] }],
          includes: { users: [{ id: 'u9', username: 'ann', name: 'Ann' }] },
        }),
    ]);
    const out = await new XInbox({ fetch: f.impl, now: () => hours(24) }).list(acct('me', 'x'), post('1'));
    expect(out[0]).toMatchObject({ externalId: '2', parentExternalId: null, authorName: 'Ann (@ann)' });
    expect(await new XInbox({ fetch: f.impl, now: () => hours(24 * 8) }).list(acct('me', 'x'), post('1'))).toEqual([]);
  });

  it('a lost reply response is ambiguous (never retried automatically)', async () => {
    const impl = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(new FacebookInbox({ graphVersion: 'v25.0', fetch: impl }).reply(acct('P', 'facebook'), post('p'), 'c1', 'Hi')).rejects.toMatchObject({ errorClass: 'ambiguous' });
  });

  it('mock comments arrive over time', async () => {
    const early = await new MockInbox('x', () => hours(0.2)).list(acct('mock-1', 'x'), post('mock_x_9'));
    const later = await new MockInbox('x', () => hours(5)).list(acct('mock-1', 'x'), post('mock_x_9'));
    expect(early.length).toBe(0);
    expect(later.length).toBeGreaterThan(0);
  });
});
