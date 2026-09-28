'use client';

import type { Platform, PostType } from '@socialos/core';
import { Field, inputClass } from '@/components/ui';

type Options = Record<string, unknown>;

interface Props {
  platform: Platform;
  postType: PostType;
  options: Options;
  onChange: (options: Options) => void;
}

/** Platform-specific settings. Field names match the schemas in @socialos/core/platforms/options. */
export function OptionsFields({ platform, postType, options, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...options };
    if (value === '' || value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const text = (key: string) => (typeof options[key] === 'string' ? (options[key] as string) : '');
  const bool = (key: string, fallback = false) => (typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback);

  const checkbox = (key: string, label: string, fallback = false) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={bool(key, fallback)} onChange={(e) => set(key, e.target.checked)} className="h-4 w-4 accent-[var(--brand-blue)]" />
      {label}
    </label>
  );

  switch (platform) {
    case 'instagram':
      return (
        <div className="space-y-3">
          {postType !== 'story' && (
            <Field label="First comment" hint="Posted as the first comment right after publishing. Good for hashtags.">
              <textarea rows={2} value={text('firstComment')} onChange={(e) => set('firstComment', e.target.value)} className={inputClass} />
            </Field>
          )}
          {postType === 'reel' && checkbox('shareReelToFeed', 'Also show this reel in the main feed', true)}
          <Field label="Collaborators" hint="Up to 3 usernames, comma separated.">
            <input
              value={Array.isArray(options.collaborators) ? (options.collaborators as string[]).join(', ') : ''}
              onChange={(e) => set('collaborators', e.target.value ? e.target.value.split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean) : undefined)}
              className={inputClass}
            />
          </Field>
        </div>
      );

    case 'facebook':
      return (
        <div className="space-y-3">
          {postType === 'text' && (
            <Field label="Link" hint="Shows a link preview under the post.">
              <input type="url" value={text('link')} onChange={(e) => set('link', e.target.value)} className={inputClass} placeholder="https://" />
            </Field>
          )}
          {postType === 'video' && (
            <Field label="Video title">
              <input value={text('videoTitle')} onChange={(e) => set('videoTitle', e.target.value)} className={inputClass} />
            </Field>
          )}
          {postType !== 'story' && (
            <Field label="First comment">
              <textarea rows={2} value={text('firstComment')} onChange={(e) => set('firstComment', e.target.value)} className={inputClass} />
            </Field>
          )}
        </div>
      );

    case 'threads':
      return (
        <Field label="Who can reply">
          <select value={text('replyControl') || 'everyone'} onChange={(e) => set('replyControl', e.target.value)} className={inputClass}>
            <option value="everyone">Everyone</option>
            <option value="accounts_you_follow">Accounts you follow</option>
            <option value="mentioned_only">Only mentioned accounts</option>
          </select>
        </Field>
      );

    case 'linkedin':
      return (
        <div className="space-y-3">
          <Field label="Visibility">
            <select value={text('visibility') || 'PUBLIC'} onChange={(e) => set('visibility', e.target.value)} className={inputClass}>
              <option value="PUBLIC">Public</option>
              <option value="CONNECTIONS">Connections only</option>
            </select>
          </Field>
          {postType === 'document' && (
            <Field label="Document title" hint="Shown above the PDF viewer.">
              <input value={text('documentTitle')} onChange={(e) => set('documentTitle', e.target.value)} className={inputClass} />
            </Field>
          )}
        </div>
      );

    case 'x':
      return (
        <Field label="Who can reply">
          <select value={text('replySettings') || 'everyone'} onChange={(e) => set('replySettings', e.target.value)} className={inputClass}>
            <option value="everyone">Everyone</option>
            <option value="following">Accounts you follow</option>
            <option value="mentionedUsers">Only mentioned accounts</option>
          </select>
        </Field>
      );

    case 'tiktok':
      return (
        <div className="space-y-3">
          <Field label="Who can view" hint="Until our TikTok app passes audit, only “Only me” posts are allowed.">
            <select value={text('privacyLevel')} onChange={(e) => set('privacyLevel', e.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              <option value="SELF_ONLY">Only me</option>
              <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
              <option value="FOLLOWER_OF_CREATOR">Followers</option>
              <option value="PUBLIC_TO_EVERYONE">Everyone</option>
            </select>
          </Field>
          <div className="grid gap-2 sm:grid-cols-3">
            {checkbox('disableComment', 'Turn off comments')}
            {checkbox('disableDuet', 'Turn off duets')}
            {checkbox('disableStitch', 'Turn off stitch')}
          </div>
          <div className="space-y-2 rounded-lg bg-surface-2 p-3">
            <p className="text-xs font-semibold">Commercial content disclosure</p>
            {checkbox('brandOrganic', 'Promotes my own business')}
            {checkbox('brandContent', 'Paid partnership / promotes a third party')}
          </div>
        </div>
      );

    case 'youtube':
      return (
        <div className="space-y-3">
          <Field label="Title" hint={`${text('title').length}/100`}>
            <input maxLength={100} value={text('title')} onChange={(e) => set('title', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Tags" hint="Comma separated.">
            <input
              value={Array.isArray(options.tags) ? (options.tags as string[]).join(', ') : ''}
              onChange={(e) => set('tags', e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined)}
              className={inputClass}
            />
          </Field>
          <Field label="Visibility">
            <select value={text('privacyStatus') || 'public'} onChange={(e) => set('privacyStatus', e.target.value)} className={inputClass}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Is this video made for kids? (required by law)</legend>
            <div className="flex gap-4 text-sm">
              {[
                ['Yes', true],
                ['No', false],
              ].map(([label, value]) => (
                <label key={String(value)} className="flex items-center gap-2">
                  <input type="radio" checked={options.madeForKids === value} onChange={() => set('madeForKids', value)} className="accent-[var(--brand-blue)]" />
                  {label as string}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      );
  }
}
