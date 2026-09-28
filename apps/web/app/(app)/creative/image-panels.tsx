'use client';

import { GRAPHIC_FORMATS, IMAGE_TIERS, type GraphicFormat, type ImageTier } from '@socialos/core';
import clsx from 'clsx';
import { Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, buttonClass, Card, Field, inputClass } from '@/components/ui';
import type { StockPhoto } from '@/lib/images/pexels';
import { generateImages, importStock, searchStock, type SavedImage } from './image-actions';

function SavedGrid({ images }: { images: SavedImage[] }) {
  if (!images.length) return null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-success">Saved to your media library</p>
        <Link href={`/compose?media=${images.map((i) => i.id).join(',')}`} className={buttonClass('secondary', 'sm')}>
          Use in a post
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {images.map((img) =>
          img.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL
            <img key={img.id} src={img.url} alt="" className="w-full rounded-lg border border-border" />
          ) : null,
        )}
      </div>
    </Card>
  );
}

export function AiImagePanel({ brandId, tiers }: { brandId: string; tiers: ImageTier[] }) {
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<ImageTier>(tiers[0] ?? 'free');
  const [format, setFormat] = useState<GraphicFormat>('portrait');
  const [count, setCount] = useState(tier === 'free' ? 2 : 1);
  const [allowText, setAllowText] = useState(false);
  const [saved, setSaved] = useState<SavedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const maxCount = tier === 'free' ? 4 : 2;

  if (!tiers.length) {
    return <Card className="p-5 text-sm text-muted">AI images aren&apos;t set up yet. Add a Cloudflare (free), Gemini or OpenAI key in the app settings.</Card>;
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <Field label="Describe the image" hint="Your Brand Brain visual style and colors are added automatically.">
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="A roofer on a sunny rooftop checking an invoice on a tablet, candid, natural light" />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">Quality</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(IMAGE_TIERS) as ImageTier[]).map((t) => {
              const available = tiers.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    setTier(t);
                    setCount((c) => Math.min(c, t === 'free' ? 4 : 2));
                  }}
                  className={clsx(
                    'rounded-lg border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
                    tier === t ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/40',
                  )}
                >
                  <span className="font-semibold">{IMAGE_TIERS[t].label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{available ? IMAGE_TIERS[t].description : 'Not set up'}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Size">
            <select value={format} onChange={(e) => setFormat(e.target.value as GraphicFormat)} className={inputClass}>
              {Object.entries(GRAPHIC_FORMATS).map(([key, f]) => (
                <option key={key} value={key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How many">
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={inputClass}>
              {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={allowText} onChange={(e) => setAllowText(e.target.checked)} className="h-4 w-4 accent-[var(--brand-blue)]" />
            Include text in the image
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await generateImages({ brandId, description, tier, format, count, allowText });
                if (res.ok && res.images) setSaved(res.images);
                else setError(res.error ?? 'Image generation failed.');
              })
            }
          >
            <Sparkles size={16} /> {pending ? 'Generating…' : 'Generate'}
          </Button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
        <p className="text-xs text-muted">Generated images are saved to Media, marked as AI-generated, and labeled as AI content when posted where the platform supports it.</p>
      </Card>
      <SavedGrid images={saved} />
    </div>
  );
}

export function StockPanel({ brandId, enabled }: { brandId: string; enabled: boolean }) {
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<'' | 'landscape' | 'portrait' | 'square'>('');
  const [format, setFormat] = useState<'' | GraphicFormat>('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [saved, setSaved] = useState<SavedImage[]>([]);
  const [importing, setImporting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!enabled) return <Card className="p-5 text-sm text-muted">Stock photos aren&apos;t set up yet (add a free Pexels API key).</Card>;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await searchStock({ brandId, query, orientation: orientation || undefined });
              if (res.ok && res.photos) setPhotos(res.photos);
              else setError(res.error ?? 'Search failed.');
            });
          }}
        >
          <div className="min-w-60 flex-1">
            <Field label="Search free photos">
              <input value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} placeholder="construction site, laptop, team meeting…" />
            </Field>
          </div>
          <Field label="Orientation">
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)} className={inputClass}>
              <option value="">Any</option>
              <option value="portrait">Portrait</option>
              <option value="square">Square</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
          <Field label="Crop to">
            <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className={inputClass}>
              <option value="">Keep original shape</option>
              {Object.entries(GRAPHIC_FORMATS).map(([key, f]) => (
                <option key={key} value={key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            <Search size={15} /> {pending && importing === null ? 'Searching…' : 'Search'}
          </Button>
        </form>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-muted">
          <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
            Photos provided by Pexels
          </a>
          . Free to use; we save the photographer&apos;s name with each photo so you can credit them.
        </p>
      </Card>

      <SavedGrid images={saved} />

      {photos.length > 0 && (
        <div className="columns-2 gap-3 md:columns-3 xl:columns-4">
          {photos.map((p) => (
            <figure key={p.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg" style={{ background: p.avgColor }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Pexels CDN thumbnail */}
              <img src={p.thumb} alt={p.alt} className="w-full" loading="lazy" />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 text-[11px] text-white">
                <a href={p.photographerUrl} target="_blank" rel="noreferrer" className="truncate hover:underline">
                  {p.photographer}
                </a>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setImporting(p.id);
                      setError(null);
                      const res = await importStock({ brandId, photoId: p.id, format: format || undefined });
                      setImporting(null);
                      if (res.ok && res.image) setSaved((s) => [res.image!, ...s]);
                      else setError(res.error ?? 'Could not save the photo.');
                    })
                  }
                >
                  {importing === p.id ? 'Saving…' : 'Use'}
                </Button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
