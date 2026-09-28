'use client';

import {
  countHashtags,
  getSpec,
  hasBlockingIssues,
  platformTextLength,
  utcToLocal,
  validateVariant,
  type MediaInfo,
  type Platform,
  type PostType,
} from '@socialos/core';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { PlatformIcon } from '@/components/platform';
import { Button, Card, Field, inputClass } from '@/components/ui';
import type { MediaWithUrl } from '@/lib/media-server';
import { submitPost, type SubmitResult } from './actions';
import { AiAssist, AiCheck, type Drafts } from './ai-assist';
import { MediaPicker } from './media-picker';
import { OptionsFields } from './options-fields';
import { inferPostType, POST_TYPE_LABELS } from './post-type';

export interface ComposerAccount {
  id: string;
  platform: Platform;
  name: string;
}

export interface InitialPost {
  id: string;
  title: string;
  /** A reviewer's note from the last rejection. */
  reviewNote?: string;
  variants: {
    socialAccountId: string;
    platform: Platform;
    postType: PostType;
    caption: string;
    threadParts: string[];
    options: Record<string, unknown>;
    media: { mediaId: string; altText?: string }[];
  }[];
}

interface VariantState {
  postType: PostType | null; // null = pick automatically from media
  caption: string | null; // null = use shared caption
  threadParts: string[];
  options: Record<string, unknown>;
  mediaIds: string[] | null; // null = use shared media
}

const TIKTOK_DEFAULTS = { privacyLevel: 'SELF_ONLY' };
const THREAD_SEPARATOR = '\n\n';

function defaultVariant(platform: Platform): VariantState {
  return { postType: null, caption: null, threadParts: [], options: platform === 'tiktok' ? { ...TIKTOK_DEFAULTS } : {}, mediaIds: null };
}

function toMediaInfo(m: MediaWithUrl): MediaInfo {
  return {
    id: m.id,
    kind: m.kind,
    mimeType: m.mime_type,
    sizeBytes: Number(m.size_bytes),
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    durationSec: m.duration_sec === null ? undefined : Number(m.duration_sec),
    pageCount: m.page_count ?? undefined,
  };
}

/** The next full hour, as wall-clock time in the brand's timezone. */
function defaultScheduleLocal(timezone: string): string {
  return utcToLocal(new Date(Date.now() + 60 * 60 * 1000), timezone).slice(0, 14) + '00';
}

export function Composer({
  brandId,
  timezone,
  accounts,
  media,
  initial,
  aiEnabled,
  needsApproval = false,
  initialBrief,
  initialMediaIds,
}: {
  brandId: string;
  timezone: string;
  accounts: ComposerAccount[];
  media: MediaWithUrl[];
  initial?: InitialPost;
  aiEnabled: boolean;
  /** Scheduling sends the post for approval instead. */
  needsApproval?: boolean;
  initialBrief?: string;
  initialMediaIds?: string[];
}) {
  const router = useRouter();
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  // When editing, the first variant's caption/media become the shared values.
  const first = initial?.variants[0];
  const [postId, setPostId] = useState(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [caption, setCaption] = useState(first?.caption ?? '');
  const [sharedMedia, setSharedMedia] = useState<string[]>(first?.media.map((m) => m.mediaId) ?? initialMediaIds ?? []);
  const [selected, setSelected] = useState<string[]>(initial?.variants.map((v) => v.socialAccountId) ?? []);
  const [variants, setVariants] = useState<Record<string, VariantState>>(() => {
    const out: Record<string, VariantState> = {};
    for (const v of initial?.variants ?? []) {
      const ids = v.media.map((m) => m.mediaId);
      out[v.socialAccountId] = {
        postType: v.postType,
        caption: v.caption === first?.caption ? null : v.caption,
        threadParts: v.threadParts,
        options: v.options,
        mediaIds: JSON.stringify(ids) === JSON.stringify(first?.media.map((m) => m.mediaId)) ? null : ids,
      };
    }
    return out;
  });
  const [tab, setTab] = useState<string>('all');
  const [scheduleLocal, setScheduleLocal] = useState(() => defaultScheduleLocal(timezone));
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, startTransition] = useTransition();

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const resolved = selected.map((accountId) => {
    const account = accountById.get(accountId)!;
    const v = variants[accountId] ?? defaultVariant(account.platform);
    const mediaIds = v.mediaIds ?? sharedMedia;
    const mediaInfo = mediaIds.map((id) => mediaById.get(id)).filter((m): m is MediaWithUrl => !!m).map(toMediaInfo);
    const postType = v.postType ?? inferPostType(account.platform, mediaInfo);
    const effectiveCaption = v.caption ?? caption;
    const issues = validateVariant({
      platform: account.platform,
      postType,
      caption: effectiveCaption,
      threadParts: v.threadParts,
      media: mediaInfo,
      options: v.options,
    });
    return { account, state: v, mediaIds, postType, caption: effectiveCaption, issues };
  });

  const blocked = resolved.some((r) => hasBlockingIssues(r.issues));

  function updateVariant(accountId: string, patch: Partial<VariantState>) {
    const platform = accountById.get(accountId)!.platform;
    setVariants((all) => ({ ...all, [accountId]: { ...(all[accountId] ?? defaultVariant(platform)), ...patch } }));
  }

  /** Puts AI drafts into each account's tab as a custom caption (the user can still edit or revert). */
  function applyDrafts(drafts: Drafts) {
    setVariants((all) => {
      const next = { ...all };
      for (const d of drafts) {
        const platform = accountById.get(d.key)?.platform;
        if (!platform) continue;
        const current = next[d.key] ?? defaultVariant(platform);
        next[d.key] = {
          ...current,
          caption: d.caption,
          threadParts: d.threadParts,
          options: d.youtubeTitle ? { ...current.options, title: d.youtubeTitle } : current.options,
        };
      }
      return next;
    });
    if (!caption.trim() && drafts[0]) setCaption(drafts[0].caption);
  }

  function toggleAccount(accountId: string) {
    setSelected((list) => (list.includes(accountId) ? list.filter((id) => id !== accountId) : [...list, accountId]));
    if (tab === accountId) setTab('all');
  }

  function submit(intent: 'draft' | 'schedule' | 'now') {
    setResult(null);
    startTransition(async () => {
      const res = await submitPost({
        postId,
        brandId,
        title,
        intent,
        scheduleLocal: intent === 'schedule' ? scheduleLocal : undefined,
        variants: resolved.map((r) => ({
          socialAccountId: r.account.id,
          platform: r.account.platform,
          postType: r.postType,
          caption: r.caption,
          threadParts: r.state.threadParts,
          options: r.state.options,
          media: r.mediaIds.map((id) => ({ mediaId: id })),
        })),
      });
      if (res.postId) setPostId(res.postId);
      setResult(res);
      if (res.ok && intent !== 'draft') router.push(res.pendingApproval ? '/approvals' : '/queue');
    });
  }

  const active = tab === 'all' ? null : resolved.find((r) => r.account.id === tab);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {initial?.reviewNote && (
          <div className="rounded-lg bg-warning/10 px-4 py-3 text-sm">
            <p className="font-semibold text-warning">Changes requested</p>
            <p className="mt-0.5 whitespace-pre-wrap">{initial.reviewNote}</p>
          </div>
        )}
        {/* Accounts */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Post to</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {accounts.map((a) => {
              const on = selected.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAccount(a.id)}
                  aria-pressed={on}
                  className={clsx(
                    'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors',
                    on ? 'border-brand bg-brand/10 text-text' : 'border-border text-muted hover:border-brand/50',
                  )}
                >
                  <PlatformIcon platform={a.platform} size={24} className="rounded-full" />
                  {a.name}
                </button>
              );
            })}
          </div>
        </Card>

        {aiEnabled && (selected.length > 0 || initialBrief) && (
          <AiAssist
            brandId={brandId}
            targets={resolved.map((r) => ({ key: r.account.id, platform: r.account.platform, postType: r.postType }))}
            onDrafts={applyDrafts}
            initialBrief={initialBrief}
          />
        )}

        {/* Tabs */}
        {selected.length > 0 && (
          <div className="flex gap-1 overflow-x-auto border-b border-border">
            <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
              All platforms
            </TabButton>
            {resolved.map((r) => (
              <TabButton key={r.account.id} active={tab === r.account.id} onClick={() => setTab(r.account.id)}>
                <PlatformIcon platform={r.account.platform} size={18} />
                {r.account.name}
                {hasBlockingIssues(r.issues) && <AlertCircle size={14} className="text-danger" />}
              </TabButton>
            ))}
          </div>
        )}

        {!active ? (
          <Card className="space-y-5 p-5">
            <Field label="Internal name" hint="Only shown inside SocialOS, e.g. in the calendar.">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="October product launch" />
            </Field>
            <Field label="Caption">
              <textarea rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} className={inputClass} placeholder="What do you want to share?" />
            </Field>
            <CaptionMeters text={caption} rows={resolved.filter((r) => r.state.caption === null)} />
            <div>
              <p className="mb-2 text-sm font-medium">Media</p>
              <MediaPicker library={media} selectedIds={sharedMedia} onChange={setSharedMedia} />
            </div>
            <p className="text-xs text-muted">Open a platform tab to change the post type, caption, media or settings for that platform only.</p>
          </Card>
        ) : (
          <VariantEditor
            key={active.account.id}
            resolved={active}
            media={media}
            sharedCaption={caption}
            sharedMedia={sharedMedia}
            onChange={(patch) => updateVariant(active.account.id, patch)}
          />
        )}
      </div>

      {/* Right column */}
      <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Checks</h2>
          {selected.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Choose at least one account.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {resolved.map((r) => {
                const errors = r.issues.filter((i) => i.severity === 'error');
                const warnings = r.issues.filter((i) => i.severity === 'warning' && i.code !== 'limits_unverified');
                return (
                  <li key={r.account.id}>
                    <button type="button" onClick={() => setTab(r.account.id)} className="flex w-full items-center gap-2 text-left text-sm font-medium">
                      <PlatformIcon platform={r.account.platform} size={20} />
                      <span className="flex-1 truncate">{r.account.name}</span>
                      <span className="text-xs text-muted">{POST_TYPE_LABELS[r.postType]}</span>
                      {errors.length ? <AlertCircle size={16} className="text-danger" /> : <CheckCircle2 size={16} className="text-success" />}
                    </button>
                    {[...errors, ...warnings].map((i, n) => (
                      <p key={n} className={clsx('ml-7 mt-1 flex gap-1.5 text-xs', i.severity === 'error' ? 'text-danger' : 'text-warning')}>
                        {i.severity === 'warning' && <TriangleAlert size={12} className="mt-0.5 shrink-0" />}
                        {i.message}
                      </p>
                    ))}
                    {result?.issues?.[r.account.id] && <p className="ml-7 mt-1 text-xs text-danger">Rejected by the server check — see above.</p>}
                    {aiEnabled && (
                      <AiCheck
                        brandId={brandId}
                        platform={r.account.platform}
                        text={[r.caption, ...r.state.threadParts].filter((t) => t.trim()).join(THREAD_SEPARATOR)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {resolved.some((r) => r.issues.some((i) => i.code === 'limits_unverified')) && (
            <p className="mt-4 rounded-lg bg-surface-2 p-2.5 text-[11px] text-muted">
              Platform limits are provisional until verified against each platform&apos;s current documentation.
            </p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <Field label="Publish at" hint={`Time zone: ${timezone}`}>
            <input type="datetime-local" value={scheduleLocal} onChange={(e) => setScheduleLocal(e.target.value)} className={inputClass} />
          </Field>

          {result?.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{result.error}</p>}
          {result?.ok && !result.scheduledFor && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Draft saved.</p>}
          {result?.shiftedForDst && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">That time doesn&apos;t exist because of daylight saving; it was moved forward.</p>
          )}

          {needsApproval && (
            <p className="rounded-lg bg-violet/10 px-3 py-2 text-xs text-violet">
              This brand requires approval. Your post goes to an owner, admin or reviewer, and is scheduled when they approve it.
            </p>
          )}
          <div className="grid gap-2">
            <Button disabled={pending || selected.length === 0 || blocked} onClick={() => submit('schedule')}>
              {needsApproval ? 'Submit for approval' : 'Schedule'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={pending || selected.length === 0} onClick={() => submit('draft')}>
                Save draft
              </Button>
              <Button variant="secondary" disabled={pending || selected.length === 0 || blocked} onClick={() => submit('now')}>
                {needsApproval ? 'Submit: post on approval' : 'Publish now'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium',
        active ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function CaptionMeters({ text, rows }: { text: string; rows: { account: ComposerAccount; postType: PostType }[] }) {
  const platforms = [...new Set(rows.map((r) => r.account.platform))];
  if (!platforms.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((p) => {
        const spec = getSpec(p);
        const length = platformTextLength(text, spec.urlWeight);
        const over = length > spec.captionMaxLength;
        return (
          <span key={p} className={clsx('tabular inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs', over ? 'text-danger' : 'text-muted')}>
            <PlatformIcon platform={p} size={18} className="rounded-full" />
            {length}/{spec.captionMaxLength}
            {spec.maxHashtags !== undefined && ` · #${countHashtags(text)}/${spec.maxHashtags}`}
          </span>
        );
      })}
    </div>
  );
}

function VariantEditor({
  resolved,
  media,
  sharedCaption,
  sharedMedia,
  onChange,
}: {
  resolved: { account: ComposerAccount; state: VariantState; postType: PostType; caption: string; mediaIds: string[] };
  media: MediaWithUrl[];
  sharedCaption: string;
  sharedMedia: string[];
  onChange: (patch: Partial<VariantState>) => void;
}) {
  const { account, state, postType } = resolved;
  const spec = getSpec(account.platform);
  const typeSpec = spec.postTypes[postType];
  const customCaption = state.caption !== null;
  const customMedia = state.mediaIds !== null;

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-center gap-3">
        <PlatformIcon platform={account.platform} size={32} />
        <div>
          <p className="font-semibold">{account.name}</p>
          <p className="text-xs text-muted">{spec.label} settings</p>
        </div>
      </div>

      <Field label="Post type" hint={typeSpec?.notes}>
        <select
          value={state.postType ?? ''}
          onChange={(e) => onChange({ postType: (e.target.value || null) as PostType | null })}
          className={inputClass}
        >
          <option value="">Automatic ({POST_TYPE_LABELS[postType]})</option>
          {(Object.keys(spec.postTypes) as PostType[]).map((t) => (
            <option key={t} value={t}>
              {POST_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={customCaption} onChange={(e) => onChange({ caption: e.target.checked ? sharedCaption : null })} className="accent-[var(--brand-blue)]" />
          Use a different caption on {spec.label}
        </label>
        <textarea
          rows={6}
          disabled={!customCaption}
          value={resolved.caption}
          onChange={(e) => onChange({ caption: e.target.value })}
          className={clsx(inputClass, !customCaption && 'opacity-60')}
        />
        <p className="tabular mt-1 text-right text-xs text-muted">
          {platformTextLength(resolved.caption, spec.urlWeight)}/{typeSpec?.captionMaxLength ?? spec.captionMaxLength}
        </p>
      </div>

      {spec.supportsThread && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Thread</p>
          {state.threadParts.map((part, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                rows={3}
                value={part}
                onChange={(e) => onChange({ threadParts: state.threadParts.map((p, n) => (n === i ? e.target.value : p)) })}
                className={inputClass}
                placeholder={`Post ${i + 2}`}
              />
              <button type="button" title="Remove" onClick={() => onChange({ threadParts: state.threadParts.filter((_, n) => n !== i) })} className="text-muted hover:text-danger">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ threadParts: [...state.threadParts, ''] })}>
            <Plus size={14} /> Add to thread
          </Button>
        </div>
      )}

      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={customMedia} onChange={(e) => onChange({ mediaIds: e.target.checked ? [...sharedMedia] : null })} className="accent-[var(--brand-blue)]" />
          Use different media on {spec.label}
        </label>
        {customMedia ? (
          <MediaPicker library={media} selectedIds={state.mediaIds!} onChange={(ids) => onChange({ mediaIds: ids })} />
        ) : (
          <p className="text-xs text-muted">Using the shared media ({sharedMedia.length} selected).</p>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <OptionsFields platform={account.platform} postType={postType} options={state.options} onChange={(options) => onChange({ options })} />
      </div>
    </Card>
  );
}
