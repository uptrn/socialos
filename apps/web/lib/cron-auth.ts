import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serverEnv } from './env';

/** Cron endpoints require `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(request: NextRequest): boolean {
  const header = request.headers.get('authorization') ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${serverEnv.cronSecret()}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
