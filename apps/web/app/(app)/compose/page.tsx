import { researchBrief, type Platform } from '@socialos/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClass, EmptyState, PageHeader } from '@/components/ui';
import { aiConfigured } from '@/lib/ai/gateway';
import { listBrandMedia } from '@/lib/media-server';
import { VARIANT_SELECT, type VariantRecord } from '@/lib/posts';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace, needsApproval } from '@/lib/workspace';
import { Composer, type ComposerAccount, type InitialPost } from './composer';

export const metadata: Metadata = { title: 'Compose' };

export default async function ComposePage({ searchParams }: PageProps<'/compose'>) {
  const { post: postParam, idea: ideaParam, media: mediaParam } = await searchParams;
  const ws = await getWorkspace();
  const supabase = await createUserClient();

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform, display_name, status')
    .eq('brand_id', ws.brand.id)
    .eq('status', 'active')
    .order('platform');

  if (!accounts?.length) {
    return (
      <>
        <PageHeader title="Compose" />
        <EmptyState
          title="Connect an account first"
          body="Add at least one social account for this brand, then come back to create a post."
          action={<Link href="/accounts" className={buttonClass()}>Go to accounts</Link>}
        />
      </>
    );
  }

  let initial: InitialPost | undefined;
  if (typeof postParam === 'string') {
    const { data: post } = await supabase
      .from('posts')
      .select(`id, title, status, review_note, post_variants(${VARIANT_SELECT})`)
      .eq('id', postParam)
      .eq('brand_id', ws.brand.id)
      .single();
    if (!post) notFound();
    if (post.status === 'pending_approval') {
      return (
        <>
          <PageHeader title="Compose" />
          <EmptyState
            title="This post is waiting for approval"
            body="It's locked while it's reviewed. Withdraw it from Approvals to make changes (you'll need to submit it again)."
            action={<Link href="/approvals" className={buttonClass()}>Open approvals</Link>}
          />
        </>
      );
    }
    if (post.status !== 'draft') {
      return (
        <>
          <PageHeader title="Compose" />
          <EmptyState
            title="This post is already scheduled"
            body="Unschedule it from the queue to edit it."
            action={<Link href="/queue" className={buttonClass()}>Open queue</Link>}
          />
        </>
      );
    }
    initial = {
      id: post.id,
      title: post.title ?? '',
      reviewNote: post.review_note ?? undefined,
      variants: (post.post_variants as unknown as VariantRecord[]).map((v) => ({
        socialAccountId: v.social_account_id,
        platform: v.platform,
        postType: v.post_type,
        caption: v.caption,
        threadParts: v.thread_parts,
        options: v.options,
        media: [...v.variant_media].sort((a, b) => a.position - b.position).map((m) => ({ mediaId: m.media_assets.id, altText: m.alt_text ?? undefined })),
      })),
    };
  }

  // "Create post" from a research idea: start the AI assistant with the idea as its brief.
  let initialBrief: string | undefined;
  if (typeof ideaParam === 'string') {
    const { data: idea } = await supabase.from('research_items').select('topic, angle, summary').eq('id', ideaParam).eq('brand_id', ws.brand.id).maybeSingle();
    if (idea) initialBrief = researchBrief(idea);
  }

  const media = await listBrandMedia(ws.brand.id);
  // "Use in a post" from the Creative studio: start with those images selected.
  const initialMediaIds =
    typeof mediaParam === 'string' ? mediaParam.split(',').filter((id) => media.some((m) => m.id === id)) : undefined;

  return (
    <>
      <PageHeader title={initial ? 'Edit draft' : 'Create post'} description={`Posting as ${ws.brand.name} · times in ${ws.brand.timezone}`} />
      <Composer
        brandId={ws.brand.id}
        timezone={ws.brand.timezone}
        accounts={accounts.map((a) => ({ id: a.id, platform: a.platform as Platform, name: a.display_name })) satisfies ComposerAccount[]}
        media={media}
        initial={initial}
        aiEnabled={aiConfigured()}
        needsApproval={needsApproval(ws, ws.brand)}
        initialBrief={initialBrief}
        initialMediaIds={initialMediaIds}
      />
    </>
  );
}
