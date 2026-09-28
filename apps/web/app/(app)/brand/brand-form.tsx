'use client';

import { useActionState } from 'react';
import { Button, Card, Field, inputClass } from '@/components/ui';
import type { BrandProfileRow } from '@/lib/brand-profile';
import { saveBrandProfile } from './actions';

function Area({ name, label, hint, value, rows = 4, disabled }: { name: string; label: string; hint?: string; value: string; rows?: number; disabled: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <textarea name={name} rows={rows} defaultValue={value} disabled={disabled} className={inputClass} />
    </Field>
  );
}

export function BrandForm({
  brandId,
  profile,
  canEdit,
  images,
}: {
  brandId: string;
  profile: BrandProfileRow;
  canEdit: boolean;
  images: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveBrandProfile, {});
  const list = (items: string[]) => items.join('\n');
  const disabled = !canEdit;

  return (
    <form action={action} className="grid gap-6 xl:grid-cols-2">
      <input type="hidden" name="brandId" value={brandId} />

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">About the brand</h2>
        <Field label="Website">
          <input name="website" type="url" defaultValue={profile.website ?? ''} disabled={disabled} className={inputClass} placeholder="https://" />
        </Field>
        <Area name="description" label="What it is" hint="One or two plain sentences." value={profile.description} rows={3} disabled={disabled} />
        <Area name="audience" label="Who it's for" hint="Customers, their roles, the problems you solve for them." value={profile.audience} disabled={disabled} />
        <Area name="products" label="Products and features" hint="Facts only: features, plans, prices, integrations." value={profile.products} rows={6} disabled={disabled} />
        <Field label="Primary call to action">
          <input name="primaryCta" defaultValue={profile.primary_cta} disabled={disabled} className={inputClass} placeholder="Start your free trial" />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Voice</h2>
        <Area name="voice" label="Tone and style" hint="e.g. plain, practical, a little dry; no exclamation marks." value={profile.voice} rows={3} disabled={disabled} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Area name="wordsToUse" label="Words to use" hint="One per line." value={list(profile.words_to_use)} disabled={disabled} />
          <Area name="wordsToAvoid" label="Words to avoid" hint="One per line." value={list(profile.words_to_avoid)} disabled={disabled} />
        </div>
        <Area name="defaultHashtags" label="Default hashtags" hint="One per line, with or without #." value={list(profile.default_hashtags)} rows={3} disabled={disabled} />
        <Area name="examplePosts" label="Example posts" hint="Posts that sound right. Separate them with a blank line." value={profile.example_posts} rows={6} disabled={disabled} />
      </Card>

      <Card className="space-y-4 p-5 xl:col-span-2">
        <h2 className="font-semibold">Claims</h2>
        <p className="-mt-2 text-sm text-muted">The AI only makes factual claims listed as approved, and the QA check flags anything else.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Area name="approvedClaims" label="Approved claims" hint="One per line, e.g. “Free 14-day trial”." value={list(profile.approved_claims)} rows={6} disabled={disabled} />
          <Area name="bannedClaims" label="Never claim" hint="One per line, e.g. “guaranteed results”." value={list(profile.banned_claims)} rows={6} disabled={disabled} />
        </div>
      </Card>

      <Card className="space-y-4 p-5 xl:col-span-2">
        <h2 className="font-semibold">Visual identity</h2>
        <p className="-mt-2 text-sm text-muted">Used by the Creative studio for graphics.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['colorPrimary', 'Primary', profile.color_primary],
              ['colorAccent', 'Accent', profile.color_accent],
              ['colorBackground', 'Background', profile.color_background],
              ['colorText', 'Text', profile.color_text],
            ] as const
          ).map(([name, label, value]) => (
            <Field key={name} label={label}>
              <input type="color" name={name} defaultValue={value} disabled={disabled} className="h-10 w-full cursor-pointer rounded-lg border border-border bg-surface p-1" />
            </Field>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Logo" hint="Upload it in Media first (PNG with a transparent background works best).">
            <select name="logoMediaId" defaultValue={profile.logo_media_id ?? ''} disabled={disabled} className={inputClass}>
              <option value="">No logo (show the brand name)</option>
              {images.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Area name="visualStyle" label="Visual style" hint="For AI images, e.g. “bright, flat illustrations, lots of white space”." value={profile.visual_style} rows={2} disabled={disabled} />
        </div>
      </Card>

      <Card className="space-y-4 p-5 xl:col-span-2">
        <h2 className="font-semibold">Research</h2>
        <p className="-mt-2 text-sm text-muted">What the Research agent looks for on the web.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Area name="researchKeywords" label="Topics and keywords" hint="One per line, e.g. “construction invoicing”." value={list(profile.research_keywords)} disabled={disabled} />
          <Area name="competitors" label="Competitors" hint="One per line: a name or website." value={list(profile.competitors)} disabled={disabled} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="researchWeekly" defaultChecked={profile.research_weekly} disabled={disabled} className="h-4 w-4 accent-[var(--brand-blue)]" />
          Run research automatically once a week
        </label>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-3 xl:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save Brand Brain'}
          </Button>
          {state.saved && !pending && <span className="text-sm text-success">Saved.</span>}
          {state.error && <span className="text-sm text-danger">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
