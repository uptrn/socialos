import { GRAPHIC_FORMATS, type GraphicFormat, type Slide, type SlideLayout } from '@socialos/core';
import { NextResponse, type NextRequest } from 'next/server';
import { renderSlideJpeg } from '@/lib/creative/render';

// Development only: renders a sample slide so template design can be checked without a database.
// GET /api/dev/creative-sample?layout=cover&format=portrait
const SAMPLES: Record<SlideLayout, Slide> = {
  cover: { layout: 'cover', eyebrow: 'Guide', title: '5 invoicing mistakes that cost contractors money', body: 'And the simple fixes that get you paid faster.', footnote: '' },
  point: { layout: 'point', eyebrow: '', title: 'Sending invoices weeks after the job', body: 'Invoice the day the work is signed off. Late invoices get paid late, or not at all.', footnote: '1/5' },
  cta: { layout: 'cta', eyebrow: '', title: 'Start your free 14-day trial', body: 'No credit card needed.', footnote: '' },
  quote: { layout: 'quote', eyebrow: '', title: 'We got paid two weeks faster in our first month.', body: '', footnote: 'Maria, Summit Roofing' },
  announcement: { layout: 'announcement', eyebrow: 'New', title: 'Job costing reports', body: 'See profit per job in one click.', footnote: 'Available today' },
  stat: { layout: 'stat', eyebrow: 'Customer survey', title: '3x', body: 'faster payments after switching to online invoices', footnote: 'Source: 2026 customer survey' },
};

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') return new NextResponse('Not found', { status: 404 });
  const params = request.nextUrl.searchParams;
  const slide = SAMPLES[(params.get('layout') as SlideLayout) ?? 'cover'] ?? SAMPLES.cover;
  const format = (params.get('format') as GraphicFormat) in GRAPHIC_FORMATS ? (params.get('format') as GraphicFormat) : 'portrait';
  const jpeg = await renderSlideJpeg(
    slide,
    { name: 'Clear Builders', primary: '#1453F5', accent: '#0BC3F5', background: '#FFFFFF', text: '#0B1A3E', website: 'https://clearbuilders.example' },
    format,
  );
  return new NextResponse(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg' } });
}
