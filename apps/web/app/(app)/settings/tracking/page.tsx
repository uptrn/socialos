import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { linkBase } from '@/lib/links';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { CodeBlock, ServerKey, TrackingToggle } from './tracking-controls';

export const metadata: Metadata = { title: 'Links and conversions' };

export default async function TrackingPage() {
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) {
    return (
      <>
        <PageHeader title="Links and conversions" />
        <EmptyState title="Owners and admins only" body="Ask an owner or admin to set up tracking." />
      </>
    );
  }
  const { data: brand } = await createAdminClient()
    .from('brands')
    .select('link_tracking, tracking_key, tracking_secret_hash')
    .eq('id', ws.brand.id)
    .single();
  const app = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  const snippet = `<script async src="${app}/api/track/script" data-key="${brand?.tracking_key}"></script>`;
  const events = `<script>
  // After a signup, trial, demo request or purchase:
  window.socialos?.track('signup');
  window.socialos?.track('purchase', { value: 49, currency: 'USD', id: 'order-123' });
</script>`;
  const curl = `curl -X POST ${app}/api/conversions \\
  -H "Authorization: Bearer sos_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"event":"purchase","click_id":"<sos_cid>","value":49,"currency":"USD","id":"order-123"}'`;

  return (
    <>
      <PageHeader title="Links and conversions" description={`${ws.brand.name} · measure what social posts bring to your website`} />
      <div className="max-w-3xl space-y-5">
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">1. Tracked links</h2>
          <p className="text-sm text-muted">
            When a post is published, each link in it is replaced by a short link ({linkBase()}/l/…) that counts clicks and adds UTM tags (source = platform, medium = social,
            campaign = post title, content = post id). Links aren&apos;t changed on Instagram and TikTok, where caption links can&apos;t be clicked, or when the short link would make
            the post too long.
          </p>
          <TrackingToggle brandId={ws.brand.id} initial={brand?.link_tracking ?? true} />
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">2. Website snippet</h2>
          <p className="text-sm text-muted">
            Add this to every page of your website, before <code>&lt;/head&gt;</code>. It remembers which tracked link a visitor came from (a first-party cookie on your site, 90
            days). Tell visitors about it in your cookie notice where the law requires.
          </p>
          <CodeBlock code={snippet} />
          <p className="text-sm text-muted">Then report conversions where they happen:</p>
          <CodeBlock code={events} />
          <p className="text-xs text-muted">Event names: lowercase letters, numbers and _ (e.g. signup, trial_started, demo_booked, purchase). Use &quot;id&quot; so repeats are counted once.</p>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">3. Server-side conversions (optional, more reliable)</h2>
          <p className="text-sm text-muted">
            Ad blockers can stop browser events. From your backend, send the click id you received (the <code>sos_cid</code> value, available in the browser as{' '}
            <code>window.socialos.clickId()</code>) with a server key. Keep the key secret.
          </p>
          <ServerKey brandId={ws.brand.id} hasKey={!!brand?.tracking_secret_hash} />
          <CodeBlock code={curl} />
        </Card>
      </div>
    </>
  );
}
