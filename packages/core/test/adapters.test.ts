import { describe, expect, it } from 'vitest';
import {
  FacebookPageAdapter,
  InstagramAdapter,
  LinkedInAdapter,
  PublishError,
  escapeLittleText,
  type AccountCredentials,
  type PublishMedia,
  type PublishRequest,
} from '../src';

/** Scripted fetch: each call is matched against the next expected [method, url-substring] pair. */
function fakeFetch(script: { match: string; method?: string; respond: () => Response }[]) {
  const calls: { url: string; method: string; body?: RequestInit['body']; headers?: RequestInit['headers'] }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body, headers: init?.headers });
    const step = script.shift();
    if (!step) throw new Error(`Unexpected call ${method} ${url}`);
    if (!url.includes(step.match) || (step.method && step.method !== method)) {
      throw new Error(`Expected ${step.method ?? '*'} ${step.match}, got ${method} ${url}`);
    }
    return step.respond();
  }) as typeof fetch;
  return { impl, calls, remaining: script };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const account = (externalAccountId: string, platform: AccountCredentials['platform']): AccountCredentials => ({
  socialAccountId: 'acc',
  platform,
  externalAccountId,
  accessToken: 'TOKEN',
});

const img = (id: string): PublishMedia => ({ id, kind: 'image', mimeType: 'image/jpeg', sizeBytes: 10, url: `https://storage/${id}.jpg` });
const vid: PublishMedia = { id: 'v', kind: 'video', mimeType: 'video/mp4', sizeBytes: 6_000_000, url: 'https://storage/v.mp4', durationSec: 20 };

function req(over: Partial<PublishRequest>): PublishRequest {
  return { jobId: 'job-1', idempotencyKey: 'k', platform: 'linkedin', postType: 'text', caption: 'Hello #launch', media: [], options: {} as never, ...over };
}

describe('LinkedIn', () => {
  const li = (f: typeof fetch) => new LinkedInAdapter({ apiVersion: '202609', fetch: f });
  const org = account('urn:li:organization:42', 'linkedin');

  it('publishes a text post and reads the post URN from x-restli-id', async () => {
    const f = fakeFetch([{ match: '/rest/posts', method: 'POST', respond: () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } }) }]);
    const res = await li(f.impl).publish(org, req({}));
    expect(res).toMatchObject({ status: 'published', externalPostId: 'urn:li:share:1', url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' });
    const body = JSON.parse(String(f.calls[0]!.body));
    expect(body).toMatchObject({ author: 'urn:li:organization:42', commentary: 'Hello #launch', lifecycleState: 'PUBLISHED', visibility: 'PUBLIC' });
    expect((f.calls[0]!.headers as Record<string, string>)['Linkedin-Version']).toBe('202609');
  });

  it('uploads two images and creates a multi-image post', async () => {
    const f = fakeFetch([
      { match: '/rest/images?action=initializeUpload', respond: () => json({ value: { uploadUrl: 'https://up/1', image: 'urn:li:image:1' } }) },
      { match: 'https://storage/a.jpg', respond: () => new Response('bytes') },
      { match: 'https://up/1', method: 'PUT', respond: () => new Response(null, { status: 201 }) },
      { match: '/rest/images?action=initializeUpload', respond: () => json({ value: { uploadUrl: 'https://up/2', image: 'urn:li:image:2' } }) },
      { match: 'https://storage/b.jpg', respond: () => new Response('bytes') },
      { match: 'https://up/2', method: 'PUT', respond: () => new Response(null, { status: 201 }) },
      { match: '/rest/posts', respond: () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:2' } }) },
    ]);
    await li(f.impl).publish(org, req({ postType: 'image', media: [img('a'), img('b')] }));
    const body = JSON.parse(String(f.calls.at(-1)!.body));
    expect(body.content.multiImage.images.map((i: { id: string }) => i.id)).toEqual(['urn:li:image:1', 'urn:li:image:2']);
  });

  it('uploads a video in parts, then waits for processing before posting', async () => {
    const f = fakeFetch([
      {
        match: '/rest/videos?action=initializeUpload',
        respond: () => json({ value: { video: 'urn:li:video:9', uploadToken: 't', uploadInstructions: [
          { uploadUrl: 'https://up/p1', firstByte: 0, lastByte: 4194303 },
          { uploadUrl: 'https://up/p2', firstByte: 4194304, lastByte: 5999999 },
        ] } }),
      },
      { match: 'https://storage/v.mp4', respond: () => new Response('part1') },
      { match: 'https://up/p1', method: 'PUT', respond: () => new Response(null, { headers: { etag: 'e1' } }) },
      { match: 'https://storage/v.mp4', respond: () => new Response('part2') },
      { match: 'https://up/p2', method: 'PUT', respond: () => new Response(null, { headers: { etag: 'e2' } }) },
      { match: '/rest/videos?action=finalizeUpload', respond: () => json({}) },
    ]);
    const adapter = li(f.impl);
    const first = await adapter.publish(org, req({ postType: 'video', media: [vid] }));
    expect(first).toMatchObject({ status: 'processing', resumeState: { kind: 'video', urn: 'urn:li:video:9' } });
    expect((f.calls[1]!.headers as Record<string, string>).Range).toBe('bytes=0-4194303');
    expect(JSON.parse(String(f.calls[5]!.body)).finalizeUploadRequest.uploadedPartIds).toEqual(['e1', 'e2']);

    const g = fakeFetch([{ match: '/rest/videos/', respond: () => json({ status: 'PROCESSING' }) }]);
    const still = await li(g.impl).resume(org, req({ postType: 'video', resumeState: { kind: 'video', urn: 'urn:li:video:9' } }));
    expect(still.status).toBe('processing');

    const h = fakeFetch([
      { match: '/rest/videos/', respond: () => json({ status: 'AVAILABLE' }) },
      { match: '/rest/posts', respond: () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:ugcPost:3' } }) },
    ]);
    const done = await li(h.impl).resume(org, req({ postType: 'video', resumeState: { kind: 'video', urn: 'urn:li:video:9' } }));
    expect(done).toMatchObject({ status: 'published', externalPostId: 'urn:li:ugcPost:3' });
  });

  it('classifies failures safely', async () => {
    const run = async (status: number, headers: Record<string, string> = {}) => {
      const f = fakeFetch([{ match: '/rest/posts', respond: () => new Response('{"message":"x"}', { status, headers }) }]);
      return li(f.impl).publish(org, req({})).catch((e: PublishError) => e);
    };
    expect(((await run(500)) as PublishError).errorClass).toBe('ambiguous'); // may have posted
    expect(((await run(401)) as PublishError).errorClass).toBe('auth_expired');
    expect(((await run(422)) as PublishError).errorClass).toBe('invalid_content');
    const limited = (await run(429, { 'retry-after': '120' })) as PublishError;
    expect([limited.errorClass, limited.retryAfterSec]).toEqual(['rate_limited', 120]);
  });

  it('treats upload failures before posting as retryable', async () => {
    const f = fakeFetch([{ match: '/rest/images?action=initializeUpload', respond: () => new Response('', { status: 503 }) }]);
    const err = (await li(f.impl).publish(org, req({ postType: 'image', media: [img('a')] })).catch((e) => e)) as PublishError;
    expect(err.errorClass).toBe('transient');
  });

  it('escapes reserved little-text characters but keeps hashtags', () => {
    expect(escapeLittleText('Price (new) @ 50% off #sale * # end')).toBe('Price \\(new\\) \\@ 50% off #sale \\* \\# end');
  });
});

describe('Instagram', () => {
  const ig = (f: typeof fetch) => new InstagramAdapter({ graphVersion: 'v25.0', fetch: f });
  const acct = account('1789', 'instagram');

  it('creates an image container, waits for it, publishes, then adds the first comment', async () => {
    const f = fakeFetch([{ match: '/v25.0/1789/media', method: 'POST', respond: () => json({ id: 'c1' }) }]);
    const first = await ig(f.impl).publish(acct, req({ platform: 'instagram', postType: 'image', media: [img('a')], caption: 'Hi' }));
    expect(first).toMatchObject({ status: 'processing', resumeState: { step: 'container', container: 'c1' } });
    expect(String(f.calls[0]!.body)).toContain('image_url=https%3A%2F%2Fstorage%2Fa.jpg');

    const g = fakeFetch([
      { match: '/v25.0/c1?', respond: () => json({ status_code: 'FINISHED' }) },
      { match: '/v25.0/1789/media_publish', method: 'POST', respond: () => json({ id: 'm1' }) },
      { match: '/v25.0/m1?', respond: () => json({ permalink: 'https://instagram.com/p/x' }) },
      { match: '/v25.0/m1/comments', method: 'POST', respond: () => json({ id: 'cm' }) },
    ]);
    const done = await ig(g.impl).resume(acct, req({ platform: 'instagram', postType: 'image', resumeState: first.status === 'processing' ? first.resumeState : undefined, options: { firstComment: '#tags' } as never }));
    expect(done).toMatchObject({ status: 'published', externalPostId: 'm1', url: 'https://instagram.com/p/x' });
  });

  it('builds a carousel from child containers', async () => {
    const f = fakeFetch([
      { match: '/1789/media', respond: () => json({ id: 'k1' }) },
      { match: '/1789/media', respond: () => json({ id: 'k2' }) },
    ]);
    const first = await ig(f.impl).publish(acct, req({ platform: 'instagram', postType: 'carousel', media: [img('a'), img('b')] }));
    expect(first).toMatchObject({ resumeState: { step: 'children', children: ['k1', 'k2'] } });

    const g = fakeFetch([
      { match: '/k1?', respond: () => json({ status_code: 'FINISHED' }) },
      { match: '/k2?', respond: () => json({ status_code: 'FINISHED' }) },
      { match: '/1789/media', respond: () => json({ id: 'parent' }) },
    ]);
    const second = await ig(g.impl).resume(acct, req({ platform: 'instagram', postType: 'carousel', resumeState: { step: 'children', children: ['k1', 'k2'] } }));
    expect(second).toMatchObject({ resumeState: { step: 'container', container: 'parent' } });
    expect(String(g.calls[2]!.body)).toContain('children=k1%2Ck2');
  });

  it('refuses to publish a container Instagram already published', async () => {
    const f = fakeFetch([{ match: '/c1?', respond: () => json({ status_code: 'PUBLISHED' }) }]);
    const err = (await ig(f.impl).resume(acct, req({ platform: 'instagram', postType: 'image', resumeState: { step: 'container', container: 'c1' } })).catch((e) => e)) as PublishError;
    expect(err.errorClass).toBe('ambiguous');
  });

  it('reports media Instagram could not process as needing revision', async () => {
    const f = fakeFetch([{ match: '/c1?', respond: () => json({ status_code: 'ERROR', status: 'bad codec' }) }]);
    const err = (await ig(f.impl).resume(acct, req({ platform: 'instagram', postType: 'reel', resumeState: { step: 'container', container: 'c1' } })).catch((e) => e)) as PublishError;
    expect(err.errorClass).toBe('invalid_content');
  });
});

describe('Facebook Page', () => {
  const fb = (f: typeof fetch) => new FacebookPageAdapter({ graphVersion: 'v25.0', fetch: f });
  const page = account('555', 'facebook');

  it('publishes a multi-photo post from unpublished photos', async () => {
    const f = fakeFetch([
      { match: '/555/photos', respond: () => json({ id: 'p1' }) },
      { match: '/555/photos', respond: () => json({ id: 'p2' }) },
      { match: '/555/feed', respond: () => json({ id: '555_99' }) },
    ]);
    const res = await fb(f.impl).publish(page, req({ platform: 'facebook', postType: 'image', media: [img('a'), img('b')], caption: 'Two' }));
    expect(res).toMatchObject({ status: 'published', externalPostId: '555_99' });
    expect(String(f.calls[0]!.body)).toContain('published=false');
    expect(decodeURIComponent(String(f.calls[2]!.body))).toContain('attached_media[1]={"media_fbid":"p2"}');
  });

  it('publishes a reel in three steps', async () => {
    const f = fakeFetch([
      { match: '/555/video_reels', respond: () => json({ video_id: 'r1', upload_url: 'x' }) },
      { match: 'rupload.facebook.com/video-upload/v25.0/r1', respond: () => json({ success: true }) },
      { match: '/555/video_reels', respond: () => json({ success: true }) },
    ]);
    const res = await fb(f.impl).publish(page, req({ platform: 'facebook', postType: 'reel', media: [vid] }));
    expect(res).toMatchObject({ externalPostId: 'r1', url: 'https://www.facebook.com/reel/r1' });
    expect((f.calls[1]!.headers as Record<string, string>).file_url).toBe('https://storage/v.mp4');
  });
});

describe('AI content labels', () => {
  it('marks Instagram posts with AI-generated media', async () => {
    const f = fakeFetch([{ match: '/1789/media', respond: () => json({ id: 'c1' }) }]);
    await new InstagramAdapter({ graphVersion: 'v25.0', fetch: f.impl }).publish(
      account('1789', 'instagram'),
      req({ platform: 'instagram', postType: 'image', media: [{ ...img('a'), aiGenerated: true }] }),
    );
    expect(String(f.calls[0]!.body)).toContain('is_ai_generated=true');

    const g = fakeFetch([{ match: '/1789/media', respond: () => json({ id: 'c2' }) }]);
    await new InstagramAdapter({ graphVersion: 'v25.0', fetch: g.impl }).publish(account('1789', 'instagram'), req({ platform: 'instagram', postType: 'image', media: [img('b')] }));
    expect(String(g.calls[0]!.body)).not.toContain('is_ai_generated');
  });
});
