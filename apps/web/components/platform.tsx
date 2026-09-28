import type { Platform } from '@socialos/core';
import clsx from 'clsx';

// Network colors are only used for small identifying chips, never as UI chrome.
export const PLATFORM_META: Record<Platform, { label: string; short: string; color: string }> = {
  facebook: { label: 'Facebook', short: 'f', color: '#1877F2' },
  instagram: { label: 'Instagram', short: 'IG', color: '#E1306C' },
  threads: { label: 'Threads', short: '@', color: '#101010' },
  linkedin: { label: 'LinkedIn', short: 'in', color: '#0A66C2' },
  x: { label: 'X', short: 'X', color: '#000000' },
  tiktok: { label: 'TikTok', short: 'TT', color: '#FE2C55' },
  youtube: { label: 'YouTube', short: '▶', color: '#FF0000' },
};

export function PlatformIcon({ platform, size = 24, className }: { platform: Platform; size?: number; className?: string }) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white ring-1 ring-white/20', className)}
      style={{ width: size, height: size, background: meta.color, fontSize: Math.round(size * 0.42) }}
    >
      {meta.short}
    </span>
  );
}
