import clsx from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { aiConfigured } from '@/lib/ai/gateway';
import { pexelsConfigured } from '@/lib/images/pexels';
import { availableTiers } from '@/lib/images/providers';
import { getWorkspace } from '@/lib/workspace';
import { CreativeStudio } from './creative-studio';
import { AiImagePanel, StockPanel } from './image-panels';

export const metadata: Metadata = { title: 'Creative' };
// AI image generation can take up to a minute per request.
export const maxDuration = 120;

const TABS = { graphics: 'Branded graphics', ai: 'AI images', stock: 'Stock photos' } as const;
type Tab = keyof typeof TABS;

export default async function CreativePage({ searchParams }: PageProps<'/creative'>) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = typeof tabParam === 'string' && tabParam in TABS ? (tabParam as Tab) : 'graphics';
  const ws = await getWorkspace();

  return (
    <>
      <PageHeader title="Creative studio" description={`Images and graphics for ${ws.brand.name}, saved straight to your media library.`} />
      <div className="mb-5 flex gap-1 border-b border-border">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <Link
            key={key}
            href={`/creative?tab=${key}`}
            className={clsx('-mb-px border-b-2 px-3 py-2.5 text-sm font-medium', tab === key ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text')}
          >
            {TABS[key]}
          </Link>
        ))}
      </div>

      {!ws.canEdit ? (
        <Card className="p-5 text-sm text-muted">You need editor access to create images.</Card>
      ) : tab === 'graphics' ? (
        <>
          <p className="mb-5 text-sm text-muted">
            Colors and logo come from the <Link href="/brand" className="font-semibold text-brand underline">Brand Brain</Link>.
          </p>
          <CreativeStudio brandId={ws.brand.id} aiEnabled={aiConfigured()} />
        </>
      ) : tab === 'ai' ? (
        <AiImagePanel brandId={ws.brand.id} tiers={availableTiers()} />
      ) : (
        <StockPanel brandId={ws.brand.id} enabled={pexelsConfigured()} />
      )}
    </>
  );
}
