// Local development scheduler: publishes due posts every 30 seconds, reads comments every
// 2 minutes and collects post metrics every 5 minutes. Run alongside `npm run dev`:  npm run worker -w @socialos/web
// In production a cron (Supabase pg_cron or Vercel Cron) calls the same endpoints.

try {
  process.loadEnvFile('.env.local');
} catch {
  // env may already be set
}

const base = process.env.APP_URL ?? 'http://localhost:3000';
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error('CRON_SECRET is not set (apps/web/.env.local).');
  process.exit(1);
}

async function call(path: string, show: (body: Record<string, number>) => boolean) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    const body = await res.json();
    if (!res.ok) console.error(`[worker] ${path} ${res.status}`, body);
    else if (show(body)) console.log(`[worker] ${new Date().toISOString()} ${path}`, body);
  } catch (e) {
    console.error(`[worker] ${(e as Error).message} — is the dev server running at ${base}?`);
  }
}

const publish = () => call('/api/cron/publish', (b) => b.claimed > 0);
const analytics = () => call('/api/cron/analytics', (b) => b.claimed > 0);
const inbox = () => call('/api/cron/inbox', (b) => b.newComments > 0 || b.failed > 0);

console.log(`[worker] publishing every 30s, reading comments every 2 min and collecting metrics every 5 min via ${base}`);
await publish();
await inbox();
await analytics();
setInterval(publish, 30_000);
setInterval(inbox, 2 * 60_000);
setInterval(analytics, 5 * 60_000);

export {};
