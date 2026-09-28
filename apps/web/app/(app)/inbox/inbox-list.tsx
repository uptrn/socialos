'use client';

import type { Platform, ReplyOutput } from '@socialos/core';
import clsx from 'clsx';
import { CheckCheck, EyeOff, ExternalLink, RotateCcw, Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { PlatformIcon } from '@/components/platform';
import { Button, Card, inputClass } from '@/components/ui';
import { hideComment, replyToComment, setCommentStatus, suggestReply } from './actions';

export interface InboxItem {
  id: string;
  platform: Platform;
  accountName: string;
  authorName: string;
  text: string;
  at: string;
  permalink: string | null;
  hidden: boolean;
  status: 'open' | 'done';
  question: boolean;
  canHide: boolean;
  post: string;
  inReplyTo: { author: string; text: string } | null;
  replies: { id: string; author: string; fromBrand: boolean; text: string; at: string }[];
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `${Math.max(1, min)}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

function Item({ item, canEdit }: { item: InboxItem; canEdit: boolean }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [suggestions, setSuggestions] = useState<ReplyOutput | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setError(res.error);
      if (!res.error) after?.();
    });

  return (
    <Card className={clsx('p-4', item.status === 'done' && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <PlatformIcon platform={item.platform} size={28} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold">{item.authorName}</span>
            <span className="text-xs text-muted">
              on {item.accountName} · {ago(item.at)} ago
            </span>
            {item.question && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">Question</span>}
            {item.hidden && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">Hidden</span>}
          </p>
          {item.inReplyTo && (
            <p className="mt-1 truncate border-l-2 border-border pl-2 text-xs text-muted">
              Replying to {item.inReplyTo.author}: {item.inReplyTo.text}
            </p>
          )}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text || <span className="text-muted">(no text)</span>}</p>
          {item.post && <p className="mt-1 truncate text-xs text-muted">Post: {item.post}</p>}

          {item.replies.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-l-2 border-brand/30 pl-3">
              {item.replies.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className={clsx('font-semibold', r.fromBrand && 'text-brand')}>{r.author}</span> <span className="text-xs text-muted">{ago(r.at)} ago</span>
                  <p className="whitespace-pre-wrap break-words">{r.text}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button type="button" size="sm" variant={open ? 'secondary' : 'primary'} onClick={() => setOpen(!open)}>
                Reply
              </Button>
            )}
            {canEdit &&
              (item.status === 'open' ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCommentStatus([item.id], 'done'))}>
                  <CheckCheck size={14} /> Done
                </Button>
              ) : (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCommentStatus([item.id], 'open'))}>
                  <RotateCcw size={14} /> Reopen
                </Button>
              ))}
            {canEdit && item.canHide && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => hideComment(item.id, !item.hidden))}>
                <EyeOff size={14} /> {item.hidden ? 'Unhide' : 'Hide'}
              </Button>
            )}
            {item.permalink && (
              <a href={item.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-text">
                Open <ExternalLink size={12} />
              </a>
            )}
          </div>

          {open && (
            <div className="mt-3 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000} placeholder="Write a reply…" aria-label="Reply" className={inputClass} />
              {suggestions && (
                <div className="space-y-1.5">
                  {suggestions.needsHuman && (
                    <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Handle this one with care{suggestions.reason ? `: ${suggestions.reason}` : '.'}</p>
                  )}
                  {suggestions.suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDraft(s.text)}
                      className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-brand/50"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.approach}</span>
                      <span className="block">{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={pending || !draft.trim()} onClick={() => run(() => replyToComment(item.id, draft), () => { setDraft(''); setOpen(false); setSuggestions(null); })}>
                  {pending ? 'Sending…' : 'Send reply'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await suggestReply(item.id);
                      setError(res.error);
                      if (res.output) setSuggestions(res.output);
                    })
                  }
                >
                  <Sparkles size={14} /> Suggest reply
                </Button>
              </div>
              <p className="text-[11px] text-muted">Replies are posted publicly from {item.accountName}.</p>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      </div>
    </Card>
  );
}

export function InboxList({ items, canEdit }: { items: InboxItem[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const openIds = items.filter((i) => i.status === 'open').map((i) => i.id);
  return (
    <div className="space-y-3">
      {canEdit && openIds.length > 1 && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await setCommentStatus(openIds, 'done')))}>
            <CheckCheck size={14} /> Mark all {openIds.length} as done
          </Button>
        </div>
      )}
      {items.map((item) => (
        <Item key={item.id} item={item} canEdit={canEdit} />
      ))}
    </div>
  );
}
