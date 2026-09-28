import { canUse } from '@socialos/core';
import { NextResponse, type NextRequest } from 'next/server';
import { cronHandler } from '@/lib/heartbeat';
import { AiError, aiConfigured } from '@/lib/ai/gateway';
import { getAccess } from '@/lib/billing/access';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runBrandResearch } from '@/lib/research';
import { createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 300;

/** Brands per call: each run takes 1-2 minutes, so a few per call stays inside maxDuration. */
const BATCH = 2;

/** Weekly research for brands that opted in. Called hourly; picks up brands not researched in 7 days. */
async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ skipped: 'AI not configured' });

  const db = createAdminClient();
  const { data: due } = await db.rpc('brands_due_for_research');
  const results: { brandId: string; items?: number; error?: string }[] = [];

  // Only plans with weekly research; filter before batching so unpaid brands can't block the queue.
  const eligible: { brand_id: string; org_id: string }[] = [];
  for (const row of (due ?? []) as { brand_id: string; org_id: string }[]) {
    const access = await getAccess(row.org_id);
    if (access.state !== 'locked' && canUse(access, 'research_weekly')) eligible.push(row);
    if (eligible.length === BATCH) break;
  }

  for (const row of eligible) {
    const { data: brand } = await db.from('brands').select('name').eq('id', row.brand_id).single();
    try {
      const items = await runBrandResearch({ orgId: row.org_id, brandId: row.brand_id, brandName: brand?.name ?? 'Brand', userId: null });
      results.push({ brandId: row.brand_id, items });
    } catch (e) {
      // A failed run is logged in agent_runs; the brand stays due and is retried next hour.
      results.push({ brandId: row.brand_id, error: e instanceof AiError ? e.kind : 'failed' });
    }
  }
  return NextResponse.json({ due: (due ?? []).length, processed: results });
}

const wrapped = cronHandler('research', handle);
export const GET = wrapped;
export const POST = wrapped;
