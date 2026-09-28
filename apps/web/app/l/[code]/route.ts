import { isBotUserAgent, isValidLinkCode } from '@socialos/core';
import { createHmac } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer-when-downgrade' };

/**
 * Anonymous visitor id for unique-click counts: HMAC of IP + browser with a secret that changes daily,
 * so it can't be reversed or linked across days. The IP itself is never stored.
 */
function visitorHash(request: NextRequest): string {
  const secret = process.env.LINK_HASH_SECRET || process.env.MEDIA_PROXY_SECRET || 'dev';
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? '';
  return createHmac('sha256', `${secret}:${day}`).update(`${ip}|${request.headers.get('user-agent') ?? ''}`).digest('hex').slice(0, 32);
}

function referrerHost(request: NextRequest): string | null {
  try {
    const ref = request.headers.get('referer');
    return ref ? new URL(ref).hostname : null;
  } catch {
    return null;
  }
}

/** Tracked link: count the click, then send the visitor to the destination (with UTMs and a click id). */
export async function GET(request: NextRequest, ctx: RouteContext<'/l/[code]'>) {
  const { code } = await ctx.params;
  if (!isValidLinkCode(code)) return new NextResponse('Link not found', { status: 404, headers: HEADERS });

  const { data, error } = await createAdminClient().rpc('record_link_click', {
    p_code: code,
    p_visitor_hash: visitorHash(request),
    p_country: request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry'),
    p_referrer_host: referrerHost(request),
    p_bot: isBotUserAgent(request.headers.get('user-agent')),
  });
  const row = (Array.isArray(data) ? data[0] : data) as { target_url: string; click_id: string | null } | undefined;
  if (error) console.error('[links] click failed', error.message);
  if (!row) return new NextResponse(error ? 'Something went wrong, please try again.' : 'Link not found', { status: error ? 503 : 404, headers: HEADERS });

  let target = row.target_url;
  if (row.click_id) {
    // The website snippet reads sos_cid to attribute later conversions to this click.
    const url = new URL(target);
    url.searchParams.set('sos_cid', row.click_id);
    target = url.toString();
  }
  return NextResponse.redirect(target, { status: 302, headers: HEADERS });
}
