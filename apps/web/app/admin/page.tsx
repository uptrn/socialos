import clsx from 'clsx';
import Link from 'next/link';
import { Card, inputClass, PageHeader } from '@/components/ui';
import { setupStatus } from '@/lib/setup';
import { createAdminClient } from '@/lib/supabase/server';

interface Overview {
  organizations: number;
  users: number;
  active_paid: number;
  trialing: number;
  locked_or_canceled: number;
  exempt: number;
  suspended: number;
  posts_published_24h: number;
  jobs_failed_24h: number;
  ai_spend_month: number;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  billing_exempt: boolean;
  suspended_at: string | null;
  plan: string | null;
  status: string | null;
  trial_ends_at: string | null;
  owner_email: string | null;
  members: number;
  brands: number;
  accounts: number;
  posts_30d: number;
  ai_spend_month: number;
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'warning' }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('tabular mt-1 text-2xl font-bold', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning')}>{value}</p>
    </Card>
  );
}

function statusLabel(o: OrgRow): { text: string; className: string } {
  if (o.suspended_at) return { text: 'Suspended', className: 'bg-danger/15 text-danger' };
  if (o.billing_exempt) return { text: 'Internal', className: 'bg-violet/12 text-violet' };
  if (o.status === 'active') return { text: o.plan ?? 'active', className: 'bg-success/15 text-success' };
  if (o.status === 'trialing') return { text: 'Trial', className: 'bg-brand/12 text-brand' };
  return { text: o.status ?? 'No plan', className: 'bg-warning/15 text-warning' };
}

export default async function AdminHome({ searchParams }: PageProps<'/admin'>) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim().toLowerCase() : '';
  const db = createAdminClient();
  const [{ data: overviewRows }, { data: orgRows }, setup] = await Promise.all([db.rpc('platform_overview'), db.rpc('platform_org_list'), setupStatus()]);
  const o = ((Array.isArray(overviewRows) ? overviewRows[0] : overviewRows) ?? {}) as Overview;
  const orgs = ((orgRows ?? []) as OrgRow[]).filter(
    (r) => !query || r.name.toLowerCase().includes(query) || r.slug.includes(query) || (r.owner_email ?? '').toLowerCase().includes(query),
  );
  const late = setup.heartbeats.filter((h) => h.late || !h.ok);

  return (
    <>
      <PageHeader title="Platform" description="All organizations on SocialOS" />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Organizations" value={o.organizations ?? 0} />
        <Tile label="Users" value={o.users ?? 0} />
        <Tile label="Paying" value={o.active_paid ?? 0} />
        <Tile label="On trial" value={o.trialing ?? 0} />
        <Tile label="Locked / canceled / past due" value={o.locked_or_canceled ?? 0} tone={o.locked_or_canceled ? 'warning' : undefined} />
        <Tile label="Internal (free)" value={o.exempt ?? 0} />
        <Tile label="Suspended" value={o.suspended ?? 0} tone={o.suspended ? 'danger' : undefined} />
        <Tile label="Posts published, 24 h" value={o.posts_published_24h ?? 0} />
        <Tile label="Failed posts, 24 h" value={o.jobs_failed_24h ?? 0} tone={o.jobs_failed_24h ? 'danger' : undefined} />
        <Tile label="AI spend this month" value={`$${Number(o.ai_spend_month ?? 0).toFixed(2)}`} />
      </div>

      <Card className="mt-5 p-4">
        <p className="text-sm font-semibold">Scheduled jobs</p>
        <p className={clsx('mt-1 text-sm', late.length ? 'text-danger' : 'text-muted')}>
          {late.length ? `Late or failing: ${late.map((h) => h.label).join(', ')}` : 'All scheduled jobs ran on time.'}{' '}
          <Link href="/settings/setup" className="text-brand hover:underline">
            Details
          </Link>
        </p>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <form className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <input name="q" defaultValue={query} placeholder="Search name, slug or owner email" aria-label="Search organizations" className={`${inputClass} max-w-sm`} />
          <span className="text-sm text-muted">{orgs.length} organization(s)</span>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm tabular">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="py-2 font-medium">Owner</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Members</th>
                <th className="py-2 text-right font-medium">Brands</th>
                <th className="py-2 text-right font-medium">Accounts</th>
                <th className="py-2 text-right font-medium">Posts 30d</th>
                <th className="py-2 text-right font-medium">AI this month</th>
                <th className="px-4 py-2 text-right font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((r) => {
                const s = statusLabel(r);
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/orgs/${r.id}`} className="font-medium text-brand hover:underline">
                        {r.name}
                      </Link>
                      <span className="block text-xs text-muted">{r.slug}</span>
                    </td>
                    <td className="py-2.5 text-muted">{r.owner_email ?? '–'}</td>
                    <td className="py-2.5">
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold capitalize', s.className)}>{s.text}</span>
                    </td>
                    <td className="py-2.5 text-right">{r.members}</td>
                    <td className="py-2.5 text-right">{r.brands}</td>
                    <td className="py-2.5 text-right">{r.accounts}</td>
                    <td className="py-2.5 text-right">{r.posts_30d}</td>
                    <td className="py-2.5 text-right">${Number(r.ai_spend_month).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  </tr>
                );
              })}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">
                    No organizations{query ? ' match that search' : ' yet'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
