'use client';

import clsx from 'clsx';
import { useState } from 'react';

export interface DayPoint {
  day: string; // YYYY-MM-DD
  posts: number;
  views: number;
  engagements: number;
}

const METRICS = { engagements: 'Engagements', views: 'Views', posts: 'Posts' } as const;
type Metric = keyof typeof METRICS;

const fmt = (v: number) => v.toLocaleString('en-US');
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

/** Round axis maximum and ticks (0, 25, 50…). */
function niceScale(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

/**
 * Daily totals by publish date, one metric at a time (one axis, one series in brand blue).
 * Each day's column is its own hover/focus target; the table below carries every value.
 */
export function DailyChart({ data }: { data: DayPoint[] }) {
  const [metric, setMetric] = useState<Metric>('engagements');
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceScale(Math.max(...data.map((d) => d[metric])));
  const top = ticks.at(-1)!;
  const labelEvery = Math.ceil(data.length / 8);
  const current = active === null ? null : data[active];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{METRICS[metric]} by publish day</h2>
        <div role="radiogroup" aria-label="Metric" className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
          {(Object.keys(METRICS) as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className={clsx('rounded-md px-3 py-1.5', metric === m ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text')}
            >
              {METRICS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex h-56 gap-2">
        {/* Y axis ticks */}
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted tabular">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}>
              {t >= 10_000 ? `${Math.round(t / 1000)}k` : fmt(t)}
            </span>
          ))}
        </div>

        <div className="relative flex-1" onPointerLeave={() => setActive(null)}>
          {/* Recessive gridlines */}
          {ticks.map((t) => (
            <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end">
            {data.map((d, i) => {
              const value = d[metric];
              return (
                <button
                  key={d.day}
                  type="button"
                  aria-label={`${dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmt(d.posts)} posts, ${fmt(d.views)} views, ${fmt(d.engagements)} engagements`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  // The full-height column is the hit target; the bar is capped at 24px with air around it.
                  className="group flex h-full min-w-0 flex-1 items-end justify-center px-[1px] focus:outline-none"
                >
                  <span
                    className={clsx('block w-full max-w-6 rounded-t bg-brand transition-opacity', active !== null && active !== i && 'opacity-45', 'group-focus-visible:ring-2 group-focus-visible:ring-brand/40')}
                    style={{ height: value ? `max(2px, ${(value / top) * 100}%)` : 0 }}
                  />
                </button>
              );
            })}
          </div>

          {current && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-card"
              style={{ left: `clamp(0px, calc(${((active + 0.5) / data.length) * 100}% - 88px), calc(100% - 176px))` }}
            >
              <p className="mb-1 font-semibold">{dayLabel(current.day, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
              {(Object.keys(METRICS) as Metric[]).map((m) => (
                <p key={m} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted">
                    {m === metric && <span className="inline-block h-0.5 w-3 rounded bg-brand" />}
                    {METRICS[m]}
                  </span>
                  <strong className="tabular font-semibold text-text">{fmt(current[m])}</strong>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* X axis: a few evenly spaced dates */}
      <div className="ml-12 mt-1.5 flex text-[11px] text-muted">
        {data.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 text-center">
            {i % labelEvery === 0 ? dayLabel(d.day, { day: 'numeric', month: 'short' }) : ''}
          </span>
        ))}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-text">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs tabular">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">Posts</th>
                <th className="py-1 text-right font-medium">Views</th>
                <th className="py-1 text-right font-medium">Engagements</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className="py-1 text-right">{fmt(d.posts)}</td>
                  <td className="py-1 text-right">{fmt(d.views)}</td>
                  <td className="py-1 text-right">{fmt(d.engagements)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
