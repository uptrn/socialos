import { describe, expect, it } from 'vitest';
import {
  FacebookPageAdapter,
  ThreadsAdapter,
  TikTokAdapter,
  XAdapter,
  YouTubeAdapter,
  type AccountCredentials,
  type PublishError,
  type PublishMedia,
  type PublishRequest,
} from '../src';

type Step = { match: string; method?: string; respond: (init?: RequestInit) => Response };

function fakeFetch(script: Step[]) {
  const calls: { url: string; method: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, init });
    const step = script.shift();
    if (!step) throw new Error(`Unexpected call ${method} ${url}`);
    if (!url.includes(step.match) || (step.method && step.method !== method)) throw new Error(`Expected ${step.method ?? '*'} ${step.match}, got ${method} ${url}`);
    return step.respond(init);
  }) as typeof fetch;
  return { impl, calls, script };
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const acct = (id: string, platform: AccountCredentials['platform']): AccountCredentials => ({ socialAccountId: 'a', platform, externalAccountId: id, accessToken: 'T' });
const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string>)[name];
const video = (size: number): PublishMedia => ({ id: 'v', kind: 'video', mimeType: 'video/mp4', sizeBytes: size, url: 'https://storage/v.mp4', durationSec: 30 });
const img = (id: string, extra: Partial<PublishMedia> = {}): PublishMedia => ({ id, kind: 'image', mimeType: 'image/jpeg', sizeBytes: 100, url: `https://storage/${id}.jpg`, ...extra });
const req = (over: Partial<PublishRequest>): PublishRequest => ({ jobId: 'j', idempotencyKey: 'k', platform: 'x', postType: 'text', caption: 'Hi', media: [], options: {} as never, ...over });

describe('YouTube', () => {
  const opts = { title: 'Demo', madeForKids: false, privacyStatus: 'public' } as never;

  it('uploads in chunks across runs and publishes on the final chunk', async () => {
    const MB = 1024 * 1024;
    const size = 20 * MB; // 8 MB chunks -> 3 chunks; budget of 8 MB per run -> 3 runs
    const f = fakeFetch([
      { match: 'uploadType=resumable', method: 'POST', respond: () => new Response(null, { headers: { location: 'https://upload/session' } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response(new Uint8Array(8 * MB)) },
      { match: 'https://upload/session', method: 'PUT', respond: () => new Response(null, { status: 308, headers: { range: `bytes=0-${8 * MB - 1}` } }) },
    ]);
    const yt = new YouTubeAdapter({ fetch: f.impl, bytesPerRun: 8 * MB });
    const first = await yt.publish(acct('UC1', 'youtube'), req({ platform: 'youtube', postType: 'video', media: [video(size)], options: opts }));
    expect(first).toMatchObject({ status: 'processing', resumeState: { uploadUrl: 'https://upload/session', offset: 8 * MB } });
    expect(header(f.calls[0]!.init, 'X-Upload-Content-Length')).toBe(String(size));
    expect(header(f.calls[2]!.init, 'Content-Range')).toBe(`bytes 0-${8 * MB - 1}/${size}`);

    const g = fakeFetch([
      { match: 'https://upload/session', method: 'PUT', respond: () => new Response(null, { status: 308, headers: { range: `bytes=0-${8 * MB - 1}` } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response(new Uint8Array(8 * MB)) },
      { match: 'https://upload/session', method: 'PUT', respond: () => new Response(null, { status: 308, headers: { range: `bytes=0-${16 * MB - 1}` } }) },
    ]);
    const second = await new YouTubeAdapter({ fetch: g.impl, bytesPerRun: 8 * MB }).resume(acct('UC1', 'youtube'), req({ platform: 'youtube', postType: 'video', media: [video(size)], options: opts, resumeState: { uploadUrl: 'https://upload/session', offset: 8 * MB } }));
    expect(second).toMatchObject({ status: 'processing', resumeState: { offset: 16 * MB } });
    expect(header(g.calls[0]!.init, 'Content-Range')).toBe(`bytes */${size}`);

    const h = fakeFetch([
      { match: 'https://upload/session', method: 'PUT', respond: () => new Response(null, { status: 308, headers: { range: `bytes=0-${16 * MB - 1}` } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response(new Uint8Array(4 * MB)) },
      { match: 'https://upload/session', method: 'PUT', respond: () => json({ id: 'vid123', status: { privacyStatus: 'private' } }, { status: 201 }) },
    ]);
    const done = await new YouTubeAdapter({ fetch: h.impl, bytesPerRun: 8 * MB }).resume(acct('UC1', 'youtube'), req({ platform: 'youtube', postType: 'video', media: [video(size)], options: opts, resumeState: { uploadUrl: 'https://upload/session', offset: 16 * MB } }));
    expect(done).toMatchObject({ status: 'published', externalPostId: 'vid123', url: 'https://www.youtube.com/watch?v=vid123' });
    expect((done as { warning?: string }).warning).toMatch(/private/);
  });
});

describe('X', () => {
  it('posts a thread; a failing reply becomes a warning, not a failure', async () => {
    const f = fakeFetch([
      { match: '/2/tweets', respond: () => json({ data: { id: '1' } }) },
      { match: '/2/tweets', respond: () => json({ data: { id: '2' } }) },
      { match: '/2/tweets', respond: () => new Response('{"detail":"dup"}', { status: 403 }) },
    ]);
    const res = await new XAdapter({ fetch: f.impl }).publish(acct('u', 'x'), req({ caption: 'one', threadParts: ['two', 'three'], options: { replySettings: 'following' } as never }));
    expect(res).toMatchObject({ status: 'published', externalPostId: '1' });
    expect((res as { warning?: string }).warning).toMatch(/post 3/);
    expect(JSON.parse(String(f.calls[1]!.init!.body))).toMatchObject({ text: 'two', reply: { in_reply_to_tweet_id: '1' }, reply_settings: 'following' });
  });

  it('uploads media, waits for video processing, then posts', async () => {
    const f = fakeFetch([
      { match: '/2/media/upload/initialize', respond: () => json({ data: { id: 'm1' } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response(new Uint8Array(1000)) },
      { match: '/2/media/upload/m1/append', respond: () => json({}) },
      { match: '/2/media/upload/m1/finalize', respond: () => json({ data: { id: 'm1', processing_info: { state: 'pending', check_after_secs: 3 } } }) },
      { match: 'command=STATUS&media_id=m1', respond: () => json({ data: { processing_info: { state: 'in_progress', check_after_secs: 4 } } }) },
    ]);
    const first = await new XAdapter({ fetch: f.impl }).publish(acct('u', 'x'), req({ postType: 'video', media: [video(1000)] }));
    expect(first).toMatchObject({ status: 'processing', checkAfterSec: 4 });
    expect(f.calls[2]!.init!.body).toBeInstanceOf(FormData);

    const g = fakeFetch([
      { match: 'command=STATUS&media_id=m1', respond: () => json({ data: { processing_info: { state: 'succeeded' } } }) },
      { match: '/2/tweets', respond: () => json({ data: { id: '9' } }) },
    ]);
    const done = await new XAdapter({ fetch: g.impl }).resume(acct('u', 'x'), req({ postType: 'video', media: [video(1000)], resumeState: (first as { resumeState: unknown }).resumeState as never }));
    expect(done).toMatchObject({ status: 'published', externalPostId: '9' });
    expect(JSON.parse(String(g.calls[1]!.init!.body)).media.media_ids).toEqual(['m1']);
  });
});

describe('TikTok', () => {
  const opts = { privacyLevel: 'SELF_ONLY' } as never;
  const creator = () => json({ data: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 }, error: { code: 'ok' } });

  it('uploads a small video as one chunk, then polls status', async () => {
    const f = fakeFetch([
      { match: '/creator_info/query/', respond: creator },
      { match: '/post/publish/video/init/', respond: () => json({ data: { publish_id: 'p1', upload_url: 'https://tt/upload' }, error: { code: 'ok' } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response(new Uint8Array(500)) },
      { match: 'https://tt/upload', method: 'PUT', respond: () => new Response(null, { status: 201 }) },
    ]);
    const first = await new TikTokAdapter({ fetch: f.impl }).publish(acct('open1', 'tiktok'), req({ platform: 'tiktok', postType: 'video', media: [video(500)], options: opts }));
    expect(first).toMatchObject({ status: 'processing', resumeState: { step: 'status', publishId: 'p1' } });
    expect(JSON.parse(String(f.calls[1]!.init!.body)).source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 500, chunk_size: 500, total_chunk_count: 1 });

    const g = fakeFetch([{ match: '/status/fetch/', respond: () => json({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }) }]);
    const done = await new TikTokAdapter({ fetch: g.impl }).resume(acct('open1', 'tiktok'), req({ platform: 'tiktok', postType: 'video', media: [video(500)], options: opts, resumeState: { step: 'status', publishId: 'p1' } }));
    expect(done).toMatchObject({ status: 'published', externalPostId: 'p1' });
  });

  it('rejects privacy levels the creator does not allow', async () => {
    const f = fakeFetch([{ match: '/creator_info/query/', respond: creator }]);
    const err = (await new TikTokAdapter({ fetch: f.impl }).publish(acct('o', 'tiktok'), req({ platform: 'tiktok', postType: 'video', media: [video(1)], options: { privacyLevel: 'PUBLIC_TO_EVERYONE' } as never })).catch((e) => e)) as PublishError;
    expect(err.errorClass).toBe('invalid_content');
  });

  it('requires app-domain URLs for photo posts', async () => {
    const f = fakeFetch([{ match: '/creator_info/query/', respond: creator }]);
    const err = (await new TikTokAdapter({ fetch: f.impl }).publish(acct('o', 'tiktok'), req({ platform: 'tiktok', postType: 'carousel', media: [img('a')], options: opts })).catch((e) => e)) as PublishError;
    expect(err.message).toMatch(/verified domain/);

    const g = fakeFetch([
      { match: '/creator_info/query/', respond: creator },
      { match: '/post/publish/content/init/', respond: () => json({ data: { publish_id: 'p2' }, error: { code: 'ok' } }) },
    ]);
    await new TikTokAdapter({ fetch: g.impl }).publish(acct('o', 'tiktok'), req({ platform: 'tiktok', postType: 'carousel', media: [img('a', { proxyUrl: 'https://app/m/a' })], options: opts }));
    expect(JSON.parse(String(g.calls[1]!.init!.body)).source_info.photo_images).toEqual(['https://app/m/a']);
  });

  it('maps TikTok error codes', async () => {
    const f = fakeFetch([{ match: '/creator_info/query/', respond: () => json({ error: { code: 'access_token_invalid', message: 'bad' } }, { status: 401 }) }]);
    const err = (await new TikTokAdapter({ fetch: f.impl }).publish(acct('o', 'tiktok'), req({ platform: 'tiktok', postType: 'video', media: [video(1)], options: opts })).catch((e) => e)) as PublishError;
    expect(err.errorClass).toBe('auth_expired');
  });
});

describe('Threads', () => {
  it('publishes a text post then its thread replies across runs', async () => {
    const t = (f: typeof fetch) => new ThreadsAdapter({ fetch: f });
    const a = acct('tu', 'threads');
    const base = req({ platform: 'threads', caption: 'main', threadParts: ['second'] });

    const f = fakeFetch([{ match: '/tu/threads', respond: () => json({ id: 'c1' }) }]);
    const s1 = await t(f.impl).publish(a, base);
    expect(s1).toMatchObject({ resumeState: { step: 'container', container: 'c1', part: -1 } });

    const g = fakeFetch([
      { match: '/c1?', respond: () => json({ status: 'FINISHED' }) },
      { match: '/tu/threads_publish', respond: () => json({ id: 'p1' }) },
      { match: '/tu/threads', respond: () => json({ id: 'c2' }) },
    ]);
    const s2 = await t(g.impl).resume(a, { ...base, resumeState: (s1 as unknown as { resumeState: never }).resumeState });
    expect(s2).toMatchObject({ resumeState: { container: 'c2', part: 0, rootId: 'p1' } });
    expect(String(g.calls[2]!.init!.body)).toContain('reply_to_id=p1');

    const h = fakeFetch([
      { match: '/c2?', respond: () => json({ status: 'ERROR', error_message: 'x' }) },
      { match: '/p1?', respond: () => json({ permalink: 'https://threads.net/p1' }) },
    ]);
    const s3 = await t(h.impl).resume(a, { ...base, resumeState: (s2 as unknown as { resumeState: never }).resumeState });
    expect(s3).toMatchObject({ status: 'published', externalPostId: 'p1', url: 'https://threads.net/p1' });
    expect((s3 as { warning?: string }).warning).toMatch(/post 2/);
  });
});

describe('Facebook stories', () => {
  it('publishes a photo story from an unpublished photo', async () => {
    const f = fakeFetch([
      { match: '/555/photos', respond: () => json({ id: 'ph' }) },
      { match: '/555/photo_stories', respond: () => json({ success: true, post_id: 'st1' }) },
    ]);
    const res = await new FacebookPageAdapter({ graphVersion: 'v25.0', fetch: f.impl }).publish(acct('555', 'facebook'), req({ platform: 'facebook', postType: 'story', media: [img('a')] }));
    expect(res).toMatchObject({ status: 'published', externalPostId: 'st1' });
  });
});
