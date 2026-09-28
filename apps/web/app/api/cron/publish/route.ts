import { runDueJobs } from '@socialos/core';
import { NextResponse, type NextRequest } from 'next/server';
import { cronHandler } from '@/lib/heartbeat';
import { isCronAuthorized } from '@/lib/cron-auth';
import { createAdapterRegistry } from '@/lib/jobs/adapters';
import { SupabaseJobRepository } from '@/lib/jobs/repository';
import { EmailJobNotifier } from '@/lib/notify';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 300;

/** Publishes every due job. Called every minute by a cron (Vercel/Supabase) or the local worker. */
async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const started = Date.now();
  const db = createAdminClient();
  const summary = await runDueJobs({
    repo: new SupabaseJobRepository(db),
    notifier: new EmailJobNotifier(db),
    adapters: createAdapterRegistry(),
    batchSize: 25,
    log: (msg, data) => console.log(`[publish] ${msg}`, data ?? ''),
  });
  return NextResponse.json({ ...summary, ms: Date.now() - started });
}

const wrapped = cronHandler('publish', handle);
export const GET = wrapped;
export const POST = wrapped;
