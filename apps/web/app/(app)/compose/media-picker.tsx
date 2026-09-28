'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MediaThumb } from '@/components/media-thumb';
import { Button, Card } from '@/components/ui';
import type { MediaWithUrl } from '@/lib/media-server';

export function MediaPicker({
  library,
  selectedIds,
  onChange,
}: {
  library: MediaWithUrl[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(library.map((m) => [m.id, m]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((m): m is MediaWithUrl => !!m);

  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {selected.map((m, i) => (
          <div key={m.id} className="group relative w-24">
            <MediaThumb media={m} />
            <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
            <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded bg-black/60 p-0.5 text-white disabled:opacity-30" title="Move left">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={() => onChange(selectedIds.filter((id) => id !== m.id))} className="rounded bg-black/60 p-0.5 text-white" title="Remove">
                <X size={14} />
              </button>
              <button type="button" disabled={i === selected.length - 1} onClick={() => move(i, 1)} className="rounded bg-black/60 p-0.5 text-white disabled:opacity-30" title="Move right">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex aspect-square w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={18} />
          Add media
        </button>
      </div>

      {open && (
        <Card className="mt-3 p-3">
          {library.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">
              Your media library is empty. <Link href="/media" className="font-semibold text-brand">Upload files</Link>
            </p>
          ) : (
            <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {library.map((m) => {
                const index = selectedIds.indexOf(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => onChange(index >= 0 ? selectedIds.filter((id) => id !== m.id) : [...selectedIds, m.id])}
                    className={clsx('relative rounded-lg p-0.5', index >= 0 ? 'ring-2 ring-brand' : 'hover:ring-1 hover:ring-border')}
                  >
                    <MediaThumb media={m} />
                    {index >= 0 && <span className="absolute right-1.5 top-1.5 rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">{index + 1}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
