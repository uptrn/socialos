import { NextResponse, type NextRequest } from 'next/server';
import { verifyMediaToken } from '@/lib/media-proxy';
import { createAdminClient } from '@/lib/supabase/server';

// Serves a stored media file for a signed, expiring link (see lib/media-proxy.ts).
export async function GET(request: NextRequest, ctx: RouteContext<'/m/[token]'>) {
  const { token } = await ctx.params;
  const payload = verifyMediaToken(token);
  if (!payload) return new NextResponse('Not found', { status: 404 });

  const { data } = await createAdminClient().storage.from('media').createSignedUrl(payload.p, 300);
  if (!data?.signedUrl) return new NextResponse('Not found', { status: 404 });

  const range = request.headers.get('range');
  const upstream = await fetch(data.signedUrl, { headers: range ? { Range: range } : undefined });
  if (!upstream.ok || !upstream.body) return new NextResponse('Not found', { status: 404 });

  const headers = new Headers({ 'Content-Type': payload.m, 'Cache-Control': 'private, max-age=300' });
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
