import { NextResponse, type NextRequest } from 'next/server';
import { conversionSchema, hashSecret, recordConversion } from '@/lib/conversions';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Server-to-server conversions:
 *   POST /api/conversions
 *   Authorization: Bearer sos_sk_...
 *   { "event": "purchase", "click_id": "<sos_cid>", "value": 49, "currency": "USD", "id": "order-123" }
 * "id" makes retries safe (the same event + id is recorded once).
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key.startsWith('sos_sk_')) return NextResponse.json({ error: 'Missing or invalid API key' }, { status: 401 });

  const { data: brand } = await createAdminClient().from('brands').select('id').eq('tracking_secret_hash', hashSecret(key)).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Missing or invalid API key' }, { status: 401 });

  const parsed = conversionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });

  try {
    const recorded = await recordConversion(brand.id, parsed.data, 'server');
    // recorded=false: duplicate id, unknown/expired click, or the per-click limit was reached.
    return NextResponse.json({ recorded }, { status: 202 });
  } catch (e) {
    console.error('[conversions]', (e as Error).message);
    return NextResponse.json({ error: 'Could not record the conversion' }, { status: 500 });
  }
}
