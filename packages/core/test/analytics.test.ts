import { describe, expect, it } from 'vitest';
import {
  byDay,
  byPlatform,
  change,
  engagementRate,
  EMPTY_METRICS,
  FacebookMetrics,
  InstagramMetrics,
  LinkedInMetrics,
  MockMetrics,
  nextCollectionAt,
  retryCollectionAt,
  totals,
  XMetrics,
  YouTubeMetrics,
  type AccountCredentials,
  type MetricRow,
  type MetricsTarget,
} from '../src';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const acct = (id: string, platform: AccountCredentials['platform']): AccountCredentials => ({ socialAccountId: 'a', platform, externalAccountId: id, accessToken: 'T' });
const T0 = new Date('2026-09-01T10:00:00Z');
const target = (jobId: string, externalPostId: string, over: Partial<MetricsTarget> = {}): MetricsTarget => ({ jobId, externalPostId, postType: 'image', publishedAt: T0, ...over });
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function fakeFetch(responses: ((url: string, init?: RequestInit) => Response)[]) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected call ${String(input)}`);
    return next(String(input), init);
  }) as typeof fetch;
  return { impl, urls };
}

describe('collection schedule', () => {
  it('collects at 1h, 24h, 3d, 7d and 30d, then stops', () => {
    expect(nextCollectionAt(T0, T0, 'x', 'text')).toEqual(hours(1));
    expect(nextCollectionAt(T0, hours(1), 'x', 'text')).toEqual(hours(24));
    expect(nextCollectionAt(T0, hours(100), 'x', 'text')).toEqual(hours(168));
    expect(nextCollectionAt(T0, hours(720), 'x', 'text')).toBeNull();
  });

  it('collects Instagram stories before their insights expire', () => {
    expect(nextCollectionAt(T0, hours(6), 'instagram', 'story')).toEqual(hours(20));
    expect(nextCollectionAt(T0, hours(20), 'instagram', 'story')).toBeNull();
  });

  it('retries failures later but not past the collection window', () => {
    expect(retryCollectionAt(T0, hours(2), 'x', 'text')).toEqual(hours(8));
    expect(retryCollectionAt(T0, hours(800), 'x', 'text')).toBeNull();
  });
});

describe('dashboard maths', () => {
  const row = (platform: MetricRow['platform'], views: number | null, likes: number, day: number): MetricRow => ({
    ...EMPTY_METRICS,
    platform,
    views,
    likes,
    comments: 1,
    publishedAt: new Date(Date.UTC(2026, 8, day, 12)),
  });
  const rows = [row('x', 1000, 49, 1), row('linkedin', 500, 24, 1), row('youtube', null, 9, 2)];

  it('totals engagement rate only over posts that report views', () => {
    const t = totals(rows);
    expect(t).toMatchObject({ posts: 3, views: 1500, engagements: 85 });
    expect(t.engagementRate).toBeCloseTo(75 / 1500);
  });

  it('groups by platform and by day', () => {
    expect(byPlatform(rows).map((p) => p.platform)).toEqual(['x', 'linkedin', 'youtube']);
    const days = byDay(rows, (d) => d.toISOString().slice(0, 10), ['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(days.map((d) => d.posts)).toEqual([2, 1, 0]);
    expect(days[0]!.engagements).toBe(75);
  });

  it('computes rates and changes safely', () => {
    expect(engagementRate({ ...EMPTY_METRICS, views: 0, likes: 5 })).toBeNull();
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(5, 0)).toBeNull();
  });
});

describe('fetchers', () => {
  it('Instagram maps insights (views, saved) and requests story metrics separately', async () => {
    const f = fakeFetch([
      () => json({ data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'reach', values: [{ value: 700 }] }, { name: 'likes', values: [{ value: 40 }] }, { name: 'comments', values: [{ value: 3 }] }, { name: 'shares', values: [{ value: 2 }] }, { name: 'saved', values: [{ value: 5 }] }] }),
      () => json({ data: [{ name: 'views', values: [{ value: 300 }] }, { name: 'total_interactions', values: [{ value: 12 }] }, { name: 'shares', values: [{ value: 2 }] }] }),
    ]);
    const out = await new InstagramMetrics({ graphVersion: 'v25.0', fetch: f.impl }).fetch(acct('ig1', 'instagram'), [target('j1', 'm1'), target('j2', 'm2', { postType: 'story' })]);
    expect(out.get('j1')).toEqual({ metrics: { views: 900, reach: 700, likes: 40, comments: 3, shares: 2, saves: 5, clicks: null } });
    expect(out.get('j2')).toMatchObject({ metrics: { views: 300, likes: 10, shares: 2 } });
    expect(f.urls[0]).toContain('/m1/insights?metric=views%2Creach%2Clikes%2Ccomments%2Cshares%2Csaved');
    expect(f.urls[1]).toContain('metric=views%2Creach%2Cshares%2Ctotal_interactions');
  });

  it('marks deleted posts as gone and keeps going', async () => {
    const f = fakeFetch([
      () => json({ error: { message: 'Object with ID m1 does not exist' } }, 400),
      () => json({ data: [{ name: 'views', values: [{ value: 1 }] }] }),
    ]);
    const out = await new InstagramMetrics({ graphVersion: 'v25.0', fetch: f.impl }).fetch(acct('ig1', 'instagram'), [target('j1', 'm1'), target('j2', 'm2')]);
    expect(out.get('j1')).toMatchObject({ gone: true });
    expect(out.get('j2')).toMatchObject({ metrics: { views: 1 } });
  });

  it('stops the whole account on an expired token', async () => {
    const f = fakeFetch([() => json({ error: { message: 'Session expired' } }, 401)]);
    await expect(new InstagramMetrics({ graphVersion: 'v25.0', fetch: f.impl }).fetch(acct('ig1', 'instagram'), [target('j1', 'm1')])).rejects.toMatchObject({ errorClass: 'auth_expired' });
  });

  it('Facebook keeps counts when insights are not permitted', async () => {
    const f = fakeFetch([
      () => json({ shares: { count: 4 }, reactions: { summary: { total_count: 30 } }, comments: { summary: { total_count: 6 } } }),
      () => json({ error: { message: '(#10) Requires read_insights permission' } }, 403),
    ]);
    const out = await new FacebookMetrics({ graphVersion: 'v25.0', fetch: f.impl }).fetch(acct('p1', 'facebook'), [target('j1', 'p1_9')]);
    expect(out.get('j1')).toMatchObject({ metrics: { likes: 30, comments: 6, shares: 4, views: null }, note: expect.stringContaining('Reconnect') });
  });

  it('X maps public metrics, asks for link clicks only on recent posts, and flags deleted posts', async () => {
    const f = fakeFetch([
      () => json({ data: [{ id: '1', public_metrics: { impression_count: 2000, like_count: 50, reply_count: 5, retweet_count: 7, quote_count: 3, bookmark_count: 4 } }] }),
    ]);
    const old = await new XMetrics({ fetch: f.impl, now: () => hours(24 * 40) }).fetch(acct('u', 'x'), [target('j1', '1'), target('j2', '2')]);
    expect(old.get('j1')).toEqual({ metrics: { views: 2000, reach: null, likes: 50, comments: 5, shares: 10, saves: 4, clicks: null } });
    expect(old.get('j2')).toMatchObject({ gone: true });
    expect(f.urls[0]).toMatch(/tweet\.fields=public_metrics$/);

    const g = fakeFetch([() => json({ data: [{ id: '1', public_metrics: { impression_count: 10 }, non_public_metrics: { url_link_clicks: 3 } }] })]);
    const recent = await new XMetrics({ fetch: g.impl, now: () => hours(48) }).fetch(acct('u', 'x'), [target('j1', '1')]);
    expect(recent.get('j1')).toMatchObject({ metrics: { views: 10, clicks: 3 } });
    expect(g.urls[0]).toContain('non_public_metrics');
  });

  it('LinkedIn queries shares and ugcPosts and treats missing posts as zero activity', async () => {
    const f = fakeFetch([
      () => json({ elements: [{ share: 'urn:li:share:1', totalShareStatistics: { impressionCount: 800, uniqueImpressionsCount: 500, likeCount: 20, commentCount: 2, shareCount: 1, clickCount: 9 } }] }),
    ]);
    const out = await new LinkedInMetrics({ apiVersion: '202609', fetch: f.impl }).fetch(acct('urn:li:organization:42', 'linkedin'), [target('j1', 'urn:li:share:1'), target('j2', 'urn:li:ugcPost:2')]);
    expect(out.get('j1')).toEqual({ metrics: { views: 800, reach: 500, likes: 20, comments: 2, shares: 1, saves: null, clicks: 9 } });
    expect(out.get('j2')).toMatchObject({ metrics: { views: 0, likes: 0 } });
    expect(f.urls[0]).toContain('organizationalEntity=urn%3Ali%3Aorganization%3A42&shares=List(urn%3Ali%3Ashare%3A1)&ugcPosts=List(urn%3Ali%3AugcPost%3A2)');
  });

  it('YouTube reads statistics in one call', async () => {
    const f = fakeFetch([() => json({ items: [{ id: 'v1', statistics: { viewCount: '1200', likeCount: '80', commentCount: '9' } }] })]);
    const out = await new YouTubeMetrics({ fetch: f.impl }).fetch(acct('UC', 'youtube'), [target('j1', 'v1'), target('j2', 'v2')]);
    expect(out.get('j1')).toMatchObject({ metrics: { views: 1200, likes: 80, comments: 9 } });
    expect(out.get('j2')).toMatchObject({ gone: true });
    expect(f.urls[0]).toContain('id=v1%2Cv2');
  });

  it('mock metrics grow over time and are stable per post', async () => {
    const early = await new MockMetrics('x', () => hours(2)).fetch(acct('mock-1', 'x'), [target('j1', 'mock_x_1')]);
    const late = await new MockMetrics('x', () => hours(200)).fetch(acct('mock-1', 'x'), [target('j1', 'mock_x_1')]);
    const views = (o: typeof early) => ('metrics' in o.get('j1')! ? (o.get('j1') as { metrics: { views: number } }).metrics.views : 0);
    expect(views(late)).toBeGreaterThan(views(early));
    expect(views(await new MockMetrics('x', () => hours(200)).fetch(acct('mock-1', 'x'), [target('j1', 'mock_x_1')]))).toBe(views(late));
  });
});

describe('insights agent', () => {
  it('numbers posts, formats metrics and cleans evidence', async () => {
    const { insightsUserPrompt, cleanInsights } = await import('../src');
    const prompt = insightsUserPrompt('Last 30 days', [
      { ...EMPTY_METRICS, platform: 'x', postType: 'text', localTime: 'Tue 09:00', caption: 'Hello\nworld', views: 1000, likes: 40, comments: 10 },
    ]);
    expect(prompt).toContain('#1 x text | Tue 09:00');
    expect(prompt).toContain('engagements 50, rate 5.0%');
    expect(prompt).toContain('caption: "Hello world"');
    const cleaned = cleanInsights({ summary: '', nextSteps: [], insights: [{ title: 't', detail: 'd', evidence: [1, 1, 7, 0], confidence: 'low' }] }, 3);
    expect(cleaned.insights[0]!.evidence).toEqual([1]);
  });
});
