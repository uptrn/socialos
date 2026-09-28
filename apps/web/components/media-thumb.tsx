import { FileText, Play } from 'lucide-react';
import type { MediaWithUrl } from '@/lib/media-server';

export function MediaThumb({ media, className = 'aspect-square' }: { media: Pick<MediaWithUrl, 'kind' | 'url' | 'original_name' | 'duration_sec'>; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-surface-2 ${className}`}>
      {media.kind === 'image' && media.url && (
        // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URLs
        <img src={media.url} alt={media.original_name ?? ''} className="h-full w-full object-cover" loading="lazy" />
      )}
      {media.kind === 'video' && media.url && (
        <>
          <video src={`${media.url}#t=0.5`} className="h-full w-full object-cover" muted preload="metadata" />
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
            <Play size={10} fill="currentColor" />
            {media.duration_sec ? `${Math.round(Number(media.duration_sec))}s` : 'Video'}
          </span>
        </>
      )}
      {media.kind === 'document' && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-muted">
          <FileText size={28} />
          <span className="line-clamp-2 text-center text-[11px]">{media.original_name}</span>
        </div>
      )}
    </div>
  );
}
