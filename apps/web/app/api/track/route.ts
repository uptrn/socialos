import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { conversionSchema, recordConversion } from '@/lib/conversions';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

// Browser events from the website snippet. The key is public, so an event only counts when it belongs
// to a real click on this brand's tracked link (limits enforced in record_conversion).
const bodySchema = z.object({ key: z.string().regex(/^[0-9a-f]{32}$/), cid: z.string().uuid() });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > 4000) return new NextResponse(null, { status: 413, headers: CORS });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS });
  }
  const base = bodySchema.safeParse(json);
  const event = conversionSchema.omit({ click_id: true }).safeParse(json);
  if (!base.success || !event.success) return new NextResponse(null, { status: 400, headers: CORS });

  const { data: brand } = await createAdminClient().from('brands').select('id').eq('tracking_key', base.data.key).maybeSingle();
  if (brand) {
    try {
      await recordConversion(brand.id, { ...event.data, click_id: base.data.cid }, 'snippet');
    } catch (e) {
      console.error('[track]', (e as Error).message);
    }
  }
  // Same answer either way: the snippet doesn't need to know, and it reveals nothing about keys.
  return new NextResponse(null, { status: 204, headers: CORS });
}
