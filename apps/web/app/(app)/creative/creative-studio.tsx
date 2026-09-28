'use client';

import { emptySlides, GRAPHIC_FORMATS, GRAPHIC_TEMPLATES, SLIDE_LIMITS, type GraphicFormat, type GraphicTemplate, type Slide } from '@socialos/core';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, buttonClass, Card, Field, inputClass } from '@/components/ui';
import { previewSlides, saveSlides, writeSlides } from './actions';

const FIELDS: { key: keyof typeof SLIDE_LIMITS; label: string; multiline?: boolean }[] = [
  { key: 'eyebrow', label: 'Label' },
  { key: 'title', label: 'Title' },
  { key: 'body', label: 'Text', multiline: true },
  { key: 'footnote', label: 'Footnote' },
];

export function CreativeStudio({ brandId, aiEnabled }: { brandId: string; aiEnabled: boolean }) {
  const [template, setTemplate] = useState<GraphicTemplate>('carousel');
  const [format, setFormat] = useState<GraphicFormat>('portrait');
  const [slides, setSlides] = useState<Slide[]>(() => emptySlides('carousel'));
  const [brief, setBrief] = useState('');
  const [slideCount, setSlideCount] = useState(6);
  const [previews, setPreviews] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[][]>([]);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [action, setAction] = useState<'write' | 'preview' | 'save' | null>(null);

  const multi = GRAPHIC_TEMPLATES[template].maxSlides > 1;

  function changeTemplate(t: GraphicTemplate) {
    setTemplate(t);
    setSlides(emptySlides(t));
    setPreviews(null);
    setSaved(null);
  }

  function update(i: number, patch: Partial<Slide>) {
    setSlides((all) => all.map((s, n) => (n === i ? { ...s, ...patch } : s)));
    setPreviews(null);
    setSaved(null);
  }

  function move(i: number, delta: number) {
    setSlides((all) => {
      const next = [...all];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item!);
      return next;
    });
    setPreviews(null);
  }

  const run = (kind: 'write' | 'preview' | 'save', fn: () => Promise<void>) =>
    start(async () => {
      setAction(kind);
      setError(null);
      try {
        await fn();
      } finally {
        setAction(null);
      }
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template">
              <select value={template} onChange={(e) => changeTemplate(e.target.value as GraphicTemplate)} className={inputClass}>
                {Object.entries(GRAPHIC_TEMPLATES).map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Size">
              <select value={format} onChange={(e) => { setFormat(e.target.value as GraphicFormat); setPreviews(null); }} className={inputClass}>
                {Object.entries(GRAPHIC_FORMATS).map(([key, f]) => (
                  <option key={key} value={key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {aiEnabled && (
            <div className="space-y-3 rounded-lg bg-violet/5 p-3">
              <Field label="What should it say?">
                <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} className={inputClass} placeholder="5 invoicing mistakes contractors make, and how to avoid them" />
              </Field>
              <div className="flex items-end gap-3">
                {multi && (
                  <Field label="Slides">
                    <input type="number" min={3} max={10} value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))} className={`${inputClass} w-20`} />
                  </Field>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className="border-violet/40 text-violet"
                  disabled={pending}
                  onClick={() =>
                    run('write', async () => {
                      const res = await writeSlides({ brandId, template, brief, slideCount: multi ? slideCount : undefined });
                      if (res.ok && res.slides) {
                        setSlides(res.slides);
                        setPreviews(null);
                        setSaved(null);
                      } else setError(res.error ?? 'Could not write the slides.');
                    })
                  }
                >
                  <Sparkles size={15} /> {action === 'write' ? 'Writing…' : 'Write with AI'}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {slides.map((slide, i) => (
          <Card key={i} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Slide {i + 1} · {slide.layout}
              </p>
              {multi && (
                <div className="flex gap-1 text-muted">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30" title="Move up"><ArrowUp size={15} /></button>
                  <button type="button" disabled={i === slides.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30" title="Move down"><ArrowDown size={15} /></button>
                  <button type="button" disabled={slides.length <= GRAPHIC_TEMPLATES[template].minSlides} onClick={() => setSlides((all) => all.filter((_, n) => n !== i))} className="hover:text-danger disabled:opacity-30" title="Remove"><Trash2 size={15} /></button>
                </div>
              )}
            </div>
            {FIELDS.map(({ key, label, multiline }) => {
              const over = slide[key].length > SLIDE_LIMITS[key];
              return (
                <Field key={key} label={label} error={over ? `${slide[key].length}/${SLIDE_LIMITS[key]} — too long to read comfortably` : undefined}>
                  {multiline ? (
                    <textarea rows={2} value={slide[key]} onChange={(e) => update(i, { [key]: e.target.value })} className={inputClass} />
                  ) : (
                    <input value={slide[key]} onChange={(e) => update(i, { [key]: e.target.value })} className={inputClass} />
                  )}
                </Field>
              );
            })}
          </Card>
        ))}
        {multi && slides.length < GRAPHIC_TEMPLATES[template].maxSlides && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSlides((all) => [...all.slice(0, -1), { layout: 'point', eyebrow: '', title: 'New point', body: '', footnote: '' }, all[all.length - 1]!])}
          >
            <Plus size={15} /> Add slide
          </Button>
        )}
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run('preview', async () => {
                const res = await previewSlides({ brandId, format, slides });
                if (res.ok && res.images) {
                  setPreviews(res.images);
                  setWarnings(res.warnings ?? []);
                } else setError(res.error ?? 'Preview failed.');
              })
            }
          >
            {action === 'preview' ? 'Rendering…' : 'Preview'}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run('save', async () => {
                const res = await saveSlides({ brandId, template, format, slides });
                if (res.ok && res.mediaIds) setSaved(res.mediaIds);
                else setError(res.error ?? 'Save failed.');
              })
            }
          >
            {action === 'save' ? 'Saving…' : `Save ${slides.length > 1 ? `${slides.length} images` : 'image'} to media`}
          </Button>
          {saved && (
            <span className="flex items-center gap-3 text-sm text-success">
              Saved.
              <Link href={`/compose?media=${saved.join(',')}`} className={buttonClass('secondary', 'sm')}>
                Use in a post
              </Link>
            </span>
          )}
          {error && <span className="text-sm text-danger">{error}</span>}
        </Card>

        {previews ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {previews.map((src, i) => (
              <figure key={i} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered data URL */}
                <img src={src} alt={`Slide ${i + 1}`} className="w-full rounded-lg border border-border" />
                {warnings[i]?.length ? <figcaption className="text-[11px] text-warning">{warnings[i]!.join('; ')}</figcaption> : null}
              </figure>
            ))}
          </div>
        ) : (
          <Card className="flex h-64 items-center justify-center text-sm text-muted">Click Preview to see your graphics.</Card>
        )}
      </div>
    </div>
  );
}
