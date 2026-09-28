import 'server-only';

// Free stock photos from Pexels (pexels.com/api/documentation). Free: 200 requests/hour,
// 20,000/month. Terms: show a prominent link to Pexels and credit photographers where possible.

export interface StockPhoto {
  id: number;
  width: number;
  height: number;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  avgColor: string;
  thumb: string;
  large: string;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string;
  alt: string;
  src: Record<'original' | 'large2x' | 'large' | 'medium' | 'small' | 'portrait' | 'landscape' | 'tiny', string>;
}

export function pexelsConfigured() {
  return !!process.env.PEXELS_API_KEY;
}

async function pexels<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.pexels.com/v1${path}`, { headers: { Authorization: process.env.PEXELS_API_KEY! } });
  if (res.status === 429) throw new Error('Stock photo search limit reached. Try again later.');
  if (!res.ok) throw new Error(`Stock photo search failed (${res.status}).`);
  return (await res.json()) as T;
}

const toStock = (p: PexelsPhoto): StockPhoto => ({
  id: p.id,
  width: p.width,
  height: p.height,
  pageUrl: p.url,
  photographer: p.photographer,
  photographerUrl: p.photographer_url,
  alt: p.alt,
  avgColor: p.avg_color,
  thumb: p.src.medium,
  large: p.src.large2x,
});

export async function searchStockPhotos(query: string, orientation?: 'landscape' | 'portrait' | 'square', page = 1) {
  const params = new URLSearchParams({ query, per_page: '24', page: String(page) });
  if (orientation) params.set('orientation', orientation);
  const body = await pexels<{ photos: PexelsPhoto[]; total_results: number }>(`/search?${params}`);
  return { photos: body.photos.map(toStock), total: body.total_results };
}

export async function getStockPhoto(id: number): Promise<StockPhoto> {
  return toStock(await pexels<PexelsPhoto>(`/photos/${id}`));
}

export async function downloadStockPhoto(photo: StockPhoto): Promise<Buffer> {
  const res = await fetch(photo.large);
  if (!res.ok) throw new Error(`Could not download the photo (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
