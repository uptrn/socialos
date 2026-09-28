import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { listBrandMedia } from '@/lib/media-server';
import { getWorkspace } from '@/lib/workspace';
import { MediaLibrary } from './media-library';

export const metadata: Metadata = { title: 'Media' };

export default async function MediaPage() {
  const ws = await getWorkspace();
  const media = await listBrandMedia(ws.brand.id);
  return (
    <>
      <PageHeader title="Media library" description="Images, videos and PDFs for your posts. Files are private to your organization." />
      <MediaLibrary brandId={ws.brand.id} media={media} canEdit={ws.canEdit} />
    </>
  );
}
