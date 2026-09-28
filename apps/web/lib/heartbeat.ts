import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from './cron-auth';
import { createAdminClient } from './supabase/server';

export const CRON_JOBS = {
  publish: { label: 'Publishing', everyMin: 1 },
  inbox: { label: 'Inbox comments', everyMin: 5 },
  analytics: { label: 'Analytics', everyMin: 15 },
  research: { label: 'Weekly research', everyMin: 60 },
  maintenance: { label: 'Daily maintenance', everyMin: 24 * 60 },
} as const;
export type CronJob = keyof typeof CRON_JOBS;

/**
 * Cron route wrapper: checks the cron secret, runs the job and records when it ran and whether it
 * succeeded (shown on Settings → Setup). Unauthorized calls are not recorded.
 */
export function cronHandler(name: CronJob, run: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) => {
    if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    let ok = false;
    let details: unknown = {};
    try {
      const res = await run(request);
      ok = res.ok;
      details = await res.clone().json().catch(() => ({}));
      return res;
    } catch (e) {
      details = { error: (e as Error).message.slice(0, 300) };
      throw e;
    } finally {
      const { error } = await createAdminClient()
        .from('system_heartbeats')
        .upsert({ name, last_run_at: new Date().toISOString(), last_ok: ok, details });
      if (error) console.error('[heartbeat]', name, error.message);
    }
  };
}
