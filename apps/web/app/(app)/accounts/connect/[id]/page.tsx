import type { Platform } from '@socialos/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { ChooseAccountsForm } from './choose-form';

export const metadata: Metadata = { title: 'Choose accounts' };

export default async function ChooseAccountsPage({ params }: PageProps<'/accounts/connect/[id]'>) {
  const { id } = await params;
  const ws = await getWorkspace();
  const { data: row } = await createAdminClient()
    .from('oauth_states')
    .select('id, user_id, org_id, brand_id, candidates, expires_at')
    .eq('id', id)
    .single();
  if (!row || row.user_id !== ws.userId || row.org_id !== ws.org.id || !row.candidates || new Date(row.expires_at) < new Date()) notFound();

  const brand = ws.brands.find((b) => b.id === row.brand_id);
  return (
    <>
      <PageHeader title="Choose accounts" description={`Select the accounts ${brand?.name ?? 'this brand'} should publish to.`} />
      <Card className="max-w-xl p-5">
        <ChooseAccountsForm
          stateId={row.id}
          candidates={row.candidates as { index: number; platform: Platform; name: string; avatarUrl?: string }[]}
        />
      </Card>
    </>
  );
}
