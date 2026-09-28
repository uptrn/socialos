import { brandGaps } from '@socialos/core';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { loadBrandProfileRow, toBrandProfile } from '@/lib/brand-profile';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { BrandForm } from './brand-form';

export const metadata: Metadata = { title: 'Brand Brain' };

export default async function BrandPage() {
  const ws = await getWorkspace();
  const row = await loadBrandProfileRow(ws.brand.id);
  const supabase = await createUserClient();
  // Uploaded images only (not generated graphics) as logo candidates.
  const { data: media } = await supabase
    .from('media_assets')
    .select('id, original_name')
    .eq('brand_id', ws.brand.id)
    .eq('kind', 'image')
    .eq('status', 'ready')
    .eq('source', 'upload')
    .order('created_at', { ascending: false })
    .limit(100);
  const images = (media ?? []).map((m) => ({ id: m.id, name: m.original_name ?? 'Image' }));
  const gaps = brandGaps(toBrandProfile(ws.brand.name, row));

  return (
    <>
      <PageHeader
        title="Brand Brain"
        description={`What SocialOS's AI knows about ${ws.brand.name}. It only states facts written here.`}
      />
      {gaps.length > 0 && (
        <Card className="mb-5 border-warning/40 bg-warning/5 p-4 text-sm">
          <span className="font-semibold text-warning">Fill in to get better AI drafts: </span>
          {gaps.join(', ')}.
        </Card>
      )}
      <BrandForm brandId={ws.brand.id} profile={row} canEdit={ws.canEdit} images={images} />
    </>
  );
}
