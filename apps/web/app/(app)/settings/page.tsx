import { ChevronRight, ClipboardCheck, CreditCard, Link2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { getAccess, getUsage } from '@/lib/billing/access';
import { getWorkspace } from '@/lib/workspace';
import { AddBrandForm } from './add-brand-form';
import { ApprovalToggle } from './approval-toggle';
import { DangerZone } from './danger-zone';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const ws = await getWorkspace();
  const [access, usage] = await Promise.all([getAccess(ws.org.id), getUsage(ws.org.id)]);
  const canManage = ['owner', 'admin'].includes(ws.role);

  return (
    <>
      <PageHeader title="Settings" description={ws.org.name} />
      <div className="max-w-3xl space-y-5">
        <Link href="/settings/billing" className="block">
          <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-surface-2">
            <CreditCard className="text-brand" />
            <div className="flex-1">
              <p className="font-semibold">Plan and billing</p>
              <p className="text-sm text-muted">
                {access.limits.label} plan
                {access.state === 'trialing' && access.trialDaysLeft !== undefined ? ` · trial, ${access.trialDaysLeft} day(s) left` : ''}
                {access.state === 'grace' ? ' · payment failed' : ''}
                {access.state === 'locked' ? ' · inactive' : ''}
              </p>
            </div>
            <ChevronRight size={18} className="text-muted" />
          </Card>
        </Link>

        {canManage && (
          <Link href="/settings/setup" className="block">
            <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-surface-2">
              <ClipboardCheck className="text-brand" />
              <div className="flex-1">
                <p className="font-semibold">Setup checklist</p>
                <p className="text-sm text-muted">What&apos;s configured, what&apos;s missing before launch, and whether scheduled jobs are running.</p>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </Card>
          </Link>
        )}

        {canManage && (
          <Link href="/settings/tracking" className="block">
            <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-surface-2">
              <Link2 className="text-brand" />
              <div className="flex-1">
                <p className="font-semibold">Links and conversions</p>
                <p className="text-sm text-muted">Tracked links, UTM tags and the website snippet for {ws.brand.name}.</p>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </Card>
          </Link>
        )}

        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="font-semibold">Brands</h2>
              <p className="text-xs text-muted">With approval on, managers&apos; posts wait for an owner, admin or reviewer before they&apos;re scheduled.</p>
            </div>
            <span className="tabular text-sm text-muted">
              {usage.brands} of {access.limits.brands} on your plan
            </span>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {ws.brands.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{b.name}</span> <span className="text-muted">· {b.timezone}</span>
                </span>
                {canManage ? (
                  <ApprovalToggle brandId={b.id} brandName={b.name} initial={b.require_approval} />
                ) : (
                  b.require_approval && <span className="text-xs text-muted">Approval required</span>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-4 border-t border-border pt-4">
              <AddBrandForm />
            </div>
          )}
        </Card>

        <DangerZone orgName={ws.org.name} isOwner={ws.role === 'owner'} />
      </div>
    </>
  );
}
