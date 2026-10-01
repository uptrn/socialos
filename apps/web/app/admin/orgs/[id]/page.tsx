import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Card, PageHeader, StatusBadge } from '@/components/ui';
import { getAccess } from '@/lib/billing/access';
import { isSaasMode } from '@/lib/mode';
import { createAdminClient } from '@/lib/supabase/server';
import { OrgControls } from './org-controls';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '–');

export default async function AdminOrgPage({ params }: PageProps<'/admin/orgs/[id]'>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = createAdminClient();
  const saas = isSaasMode();
  const { data: org } = await db.from('organizations').select('id, name, slug, created_at, billing_exempt, suspended_at, suspended_reason').eq('id', id).maybeSingle();
  if (!org) notFound();

  const [access, { data: sub }, { data: members }, { data: brands }, { data: accounts }, { data: jobs }, { data: logs }] = await Promise.all([
    getAccess(id),
    db.from('subscriptions').select('plan, status, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id').eq('org_id', id).maybeSingle(),
    db.rpc('org_member_list', { p_org: id }),
    db.from('brands').select('id, name, timezone, status, require_approval').eq('org_id', id).order('created_at'),
    db.from('social_accounts').select('id, platform, display_name, status, status_reason').eq('org_id', id).order('platform'),
    db.from('publish_jobs').select('id, platform, status, scheduled_at, last_error_message').eq('org_id', id).order('scheduled_at', { ascending: false }).limit(15),
    db.from('audit_logs').select('id, action, actor_type, created_at, details').eq('org_id', id).order('created_at', { ascending: false }).limit(25),
  ]);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin" className="text-brand hover:underline">
          ← All organizations
        </Link>
      </p>
      <PageHeader title={org.name} description={`${org.slug} · created ${fmt(org.created_at)}`} />
      {org.suspended_at && (
        <p className="mb-5 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
          Suspended {fmt(org.suspended_at)}: {org.suspended_reason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {!saas && (
            <Card className="p-5 text-sm">
              <h2 className="font-semibold">Access</h2>
              <p className="mt-1 text-muted">
                {access.limits.label} plan · up to {access.limits.brands} brands, {access.limits.socialAccounts} accounts, ${access.limits.aiBudgetUsd} of AI per month
                {access.message ? ` · ${access.message}` : ''}
              </p>
            </Card>
          )}
          {saas && (
          <Card className="p-5">
            <h2 className="font-semibold">Billing</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[160px_1fr]">
              <dt className="text-muted">Access</dt>
              <dd>
                {access.limits.label} · {access.state}
                {access.message ? ` · ${access.message}` : ''}
              </dd>
              <dt className="text-muted">Subscription</dt>
              <dd>{sub ? `${sub.plan} · ${sub.status}${sub.cancel_at_period_end ? ' · cancels at period end' : ''}` : 'none'}</dd>
              <dt className="text-muted">Trial ends</dt>
              <dd>{fmt(sub?.trial_ends_at ?? null)}</dd>
              <dt className="text-muted">Period ends</dt>
              <dd>{fmt(sub?.current_period_end ?? null)}</dd>
              <dt className="text-muted">Stripe</dt>
              <dd>
                {sub?.stripe_customer_id ? (
                  <a href={`https://dashboard.stripe.com/customers/${sub.stripe_customer_id}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    Open customer in Stripe
                  </a>
                ) : (
                  '–'
                )}
              </dd>
            </dl>
          </Card>
          )}

          <Card className="p-5">
            <h2 className="font-semibold">Members</h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {((members ?? []) as { user_id: string; email: string; role: string; joined_at: string }[]).map((m) => (
                <li key={m.user_id} className="flex justify-between py-2">
                  <span>{m.email}</span>
                  <span className="text-muted">
                    {m.role} · joined {fmt(m.joined_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Brands and accounts</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {(brands ?? []).map((b) => (
                <li key={b.id}>
                  <span className="font-medium">{b.name}</span>{' '}
                  <span className="text-muted">
                    · {b.timezone}
                    {b.status !== 'active' ? ` · ${b.status}` : ''}
                    {b.require_approval ? ' · approvals on' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-3 divide-y divide-border text-sm">
              {(accounts ?? []).map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {a.platform} · {a.display_name}
                  </span>
                  <span className="text-muted">
                    {a.status}
                    {a.status_reason ? `: ${a.status_reason}` : ''}
                  </span>
                </li>
              ))}
              {(accounts ?? []).length === 0 && <li className="py-2 text-muted">No connected accounts.</li>}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Recent publish jobs</h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {(jobs ?? []).map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {j.platform} · {fmt(j.scheduled_at)}
                  </span>
                  <span className="flex items-center gap-2">
                    {j.last_error_message && <span className="max-w-xs truncate text-xs text-muted">{j.last_error_message}</span>}
                    <StatusBadge status={j.status} />
                  </span>
                </li>
              ))}
              {(jobs ?? []).length === 0 && <li className="py-2 text-muted">No posts scheduled yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Actions</h2>
            <OrgControls id={org.id} suspended={!!org.suspended_at} exempt={org.billing_exempt} stripeManaged={!saas || !!sub?.stripe_subscription_id} />
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Audit log</h2>
            <ul className="mt-2 space-y-2 text-xs">
              {(logs ?? []).map((l) => (
                <li key={l.id}>
                  <span className={l.actor_type === 'platform_admin' ? 'font-semibold text-danger' : 'font-medium'}>{l.action}</span>
                  <span className="block text-muted">
                    {l.actor_type} · {fmt(l.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
