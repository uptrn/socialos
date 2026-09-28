import { NextResponse, type NextRequest } from 'next/server';
import { cronHandler } from '@/lib/heartbeat';
import { isCronAuthorized } from '@/lib/cron-auth';
import { syncDueInbox } from '@/lib/inbox/sync';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 300;

/** Reads new comments on published posts that are due. Called every 5 minutes. */
async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const started = Date.now();
  const summary = await syncDueInbox(createAdminClient());
  return NextResponse.json({ ...summary, ms: Date.now() - started });
}

const wrapped = cronHandler('inbox', handle);
export const GET = wrapped;
export const POST = wrapped;
