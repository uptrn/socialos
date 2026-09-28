import clsx from 'clsx';
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { setupStatus } from '@/lib/setup';
import { getWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Setup checklist' };

function StatusIcon({ ok, required }: { ok: boolean; required: boolean }) {
  // Shape and label carry the state, not only color.
  if (ok) return <CircleCheck size={18} className="shrink-0 text-success" aria-label="Done" />;
  if (required) return <CircleAlert size={18} className="shrink-0 text-danger" aria-label="Needed before launch" />;
  return <CircleDashed size={18} className="shrink-0 text-muted" aria-label="Optional" />;
}

export default async function SetupPage() {
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) {
    return (
      <>
        <PageHeader title="Setup checklist" />
        <EmptyState title="Owners and admins only" body="Ask an owner or admin to check the setup." />
      </>
    );
  }
  const { sections, heartbeats } = await setupStatus();
  const missing = sections.flatMap((s) => s.items).filter((i) => i.required && !i.ok).length;
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: ws.brand.timezone, dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <PageHeader
        title="Setup checklist"
        description={missing ? `${missing} required item${missing === 1 ? '' : 's'} left before launch` : 'Everything required is configured'}
      />
      <div className="max-w-3xl space-y-5">
        <Card className="p-5">
          <h2 className="font-semibold">Scheduled jobs</h2>
          <p className="text-xs text-muted">Run by Supabase cron in production (supabase/ops/schedule-publisher.sql) or the local worker.</p>
          <ul className="mt-3 divide-y divide-border">
            {heartbeats.map((h) => (
              <li key={h.job} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <StatusIcon ok={!h.late && h.ok} required />
                  {h.label}
                </span>
                <span className={clsx('text-xs', h.late || !h.ok ? 'text-danger' : 'text-muted')}>
                  {!h.lastRun ? 'Never ran' : `${h.late ? 'Late. ' : ''}${h.ok ? 'Last run' : 'Last run failed'} ${fmt(h.lastRun)}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {sections.map((s) => (
          <Card key={s.title} className="p-5">
            <h2 className="font-semibold">{s.title}</h2>
            <ul className="mt-2 divide-y divide-border">
              {s.items.map((i) => (
                <li key={i.label} className="flex items-start gap-2 py-2.5 text-sm">
                  <StatusIcon ok={i.ok} required={i.required} />
                  <div>
                    <p className="font-medium">
                      {i.label} {!i.ok && <span className={clsx('text-xs font-normal', i.required ? 'text-danger' : 'text-muted')}>{i.required ? 'required' : 'optional'}</span>}
                    </p>
                    {!i.ok && <p className="text-xs text-muted">{i.hint}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-xs text-muted">Only whether each setting exists is shown; secret values are never displayed. Full guide: docs/deploy.md.</p>
      </div>
    </>
  );
}
