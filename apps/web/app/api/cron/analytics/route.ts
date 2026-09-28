import { NextResponse, type NextRequest } from 'next/server';
import { cronHandler } from '@/lib/heartbeat';
import { collectDueMetrics } from '@/lib/analytics/collect';
import { isCronAuthorized } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 300;

/** Collects post metrics that are due (1h, 24h, 3d, 7d, 30d after publishing). Called every 15 minutes. */
async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const started = Date.now();
  const summary = await collectDueMetrics(createAdminClient());
  return NextResponse.json({ ...summary, ms: Date.now() - started });
}

const wrapped = cronHandler('analytics', handle);
export const GET = wrapped;
export const POST = wrapped;
