import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Uptime check: the app is up and can reach the database. Reveals no configuration. */
export async function GET() {
  const started = Date.now();
  try {
    const { error } = await createAdminClient().from('organizations').select('id', { head: true, count: 'estimated' }).limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, ms: Date.now() - started }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
