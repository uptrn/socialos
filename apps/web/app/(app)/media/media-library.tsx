'use client';

import { Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { MediaThumb } from '@/components/media-thumb';
import { Button, Card, EmptyState } from '@/components/ui';
import { ALLOWED_MEDIA, formatBytes } from '@/lib/media';
import type { MediaWithUrl } from '@/lib/media-server';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { deleteMedia, finishUpload, startUpload } from './actions';

const SOURCE_BADGE: Record<string, string> = { ai_image: 'AI', stock: 'Stock', template: 'Graphic' };

interface UploadItem {
  name: string;
  status: 'reading' | 'uploading' | 'done' | 'error';
  error?: string;
}

async function readMetadata(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const kind = ALLOWED_MEDIA[file.type];
  if (kind === 'image') {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  if (kind === 'video') {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () =>
          resolve({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationSec: video.duration || undefined });
        video.onerror = () => resolve({}); // unreadable in this browser; validated again before publishing
        video.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return {};
}

export function MediaLibrary({ brandId, media, canEdit }: { brandId: string; media: MediaWithUrl[]; canEdit: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const update = (name: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((u) => (u.name === name ? { ...u, ...patch } : u)));

  async function uploadFiles(files: FileList) {
    const supabase = createBrowserSupabase();
    const list = Array.from(files);
    setUploads(list.map((f) => ({ name: f.name, status: 'reading' })));

    for (const file of list) {
      try {
        if (!(file.type in ALLOWED_MEDIA)) throw new Error('Unsupported file type');
        const meta = await readMetadata(file);
        update(file.name, { status: 'uploading' });
        const { id, path, token } = await startUpload({
          brandId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          width: meta.width,
          height: meta.height,
          durationSec: meta.durationSec,
        });
        const { error } = await supabase.storage.from('media').uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw error;
        await finishUpload(id, brandId);
        update(file.name, { status: 'done' });
      } catch (e) {
        update(file.name, { status: 'error', error: (e as Error).message });
      }
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <Card
          className="flex flex-col items-center justify-center border-dashed px-6 py-10 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="text-brand" size={28} />
          <p className="mt-2 font-semibold">Drop files here or choose from your computer</p>
          <p className="mt-1 text-xs text-muted">JPG, PNG, WebP, GIF, MP4, MOV, WebM, PDF · up to 5 GB</p>
          <Button className="mt-4" variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={Object.keys(ALLOWED_MEDIA).join(',')}
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          {uploads.length > 0 && (
            <ul className="mt-5 w-full max-w-md space-y-1 text-left text-sm">
              {uploads.map((u) => (
                <li key={u.name} className="flex justify-between gap-3">
                  <span className="truncate">{u.name}</span>
                  <span className={u.status === 'error' ? 'text-danger' : u.status === 'done' ? 'text-success' : 'text-muted'}>
                    {u.status === 'error' ? u.error : u.status === 'done' ? 'Uploaded' : u.status === 'reading' ? 'Reading…' : 'Uploading…'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {deleteError && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{deleteError}</p>}

      {media.length === 0 ? (
        <EmptyState title="No media yet" body="Upload images, videos or PDFs to use them in your posts." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {media.map((m) => (
            <Card key={m.id} className="group relative overflow-hidden p-2">
              <MediaThumb media={m} />
              {m.source && SOURCE_BADGE[m.source] && (
                <span className="absolute left-3.5 top-3.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">{SOURCE_BADGE[m.source]}</span>
              )}
              <div className="mt-2 flex items-start justify-between gap-2 px-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{m.original_name}</p>
                  <p className="tabular text-[11px] text-muted">
                    {formatBytes(m.size_bytes)}
                    {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <button
                    title="Delete"
                    className="text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    onClick={() =>
                      startTransition(async () => {
                        setDeleteError(null);
                        try {
                          await deleteMedia(m.id, brandId);
                        } catch (e) {
                          setDeleteError((e as Error).message);
                        }
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
