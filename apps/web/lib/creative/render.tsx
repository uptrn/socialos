import 'server-only';
import { GRAPHIC_FORMATS, type GraphicFormat, type Slide } from '@socialos/core';
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// Renders template slides to JPEG (Instagram only accepts JPEG) with the brand's colors,
// font and logo. Layout uses flexbox only (ImageResponse / Satori limitation).

export interface BrandLook {
  name: string;
  primary: string;
  accent: string;
  background: string;
  text: string;
  /** PNG data URL of the logo, if the brand has one. */
  logoDataUrl?: string;
  website?: string | null;
}

const fontFile = (weight: number) => readFile(join(process.cwd(), 'assets/fonts', `plus-jakarta-sans-latin-${weight}-normal.woff`));
// Read once per server process.
const fontsPromise = Promise.all([500, 700, 800].map(async (weight) => ({ name: 'Jakarta', data: await fontFile(weight), weight: weight as 500 | 700 | 800, style: 'normal' as const })));

function Frame({ look, children, dark, scale, footnote }: { look: BrandLook; children: React.ReactNode; dark?: boolean; scale: number; footnote?: string }) {
  const fg = dark ? '#FFFFFF' : look.text;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: dark ? look.primary : look.background, color: fg, fontFamily: 'Jakarta' }}>
      <div style={{ display: 'flex', height: 14 * scale, background: `linear-gradient(90deg, ${look.accent}, ${look.primary})` }} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: `${72 * scale}px ${80 * scale}px`, justifyContent: 'center' }}>{children}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${80 * scale}px ${56 * scale}px` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {look.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser
            <img src={look.logoDataUrl} height={56 * scale} style={{ height: 56 * scale }} alt="" />
          ) : (
            <span style={{ fontSize: 30 * scale, fontWeight: 800 }}>{look.name}</span>
          )}
        </div>
        {footnote ? <span style={{ fontSize: 26 * scale, fontWeight: 500, opacity: 0.7 }}>{footnote}</span> : null}
      </div>
    </div>
  );
}

function Eyebrow({ text, look, scale, onDark }: { text: string; look: BrandLook; scale: number; onDark?: boolean }) {
  if (!text) return null;
  return (
    <div style={{ display: 'flex', marginBottom: 32 * scale }}>
      <span
        style={{
          fontSize: 26 * scale,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 2 * scale,
          padding: `${10 * scale}px ${22 * scale}px`,
          borderRadius: 999,
          background: onDark ? 'rgba(255,255,255,0.18)' : look.primary,
          color: '#FFFFFF',
        }}
      >
        {text}
      </span>
    </div>
  );
}

function SlideView({ slide, look, scale }: { slide: Slide; look: BrandLook; scale: number }) {
  const body = (size: number, extra: React.CSSProperties = {}) =>
    slide.body ? <p style={{ fontSize: size * scale, fontWeight: 500, lineHeight: 1.4, opacity: 0.8, margin: 0, ...extra }}>{slide.body}</p> : null;

  switch (slide.layout) {
    case 'cover':
      return (
        <Frame look={look} scale={scale} footnote={slide.footnote || 'Swipe →'}>
          <Eyebrow text={slide.eyebrow} look={look} scale={scale} />
          <h1 style={{ fontSize: 92 * scale, fontWeight: 800, lineHeight: 1.08, margin: `0 0 ${32 * scale}px`, color: look.text }}>{slide.title}</h1>
          {body(40)}
        </Frame>
      );
    case 'point':
      return (
        <Frame look={look} scale={scale}>
          {slide.footnote ? <span style={{ fontSize: 34 * scale, fontWeight: 800, color: look.primary, marginBottom: 24 * scale }}>{slide.footnote}</span> : null}
          <h2 style={{ fontSize: 72 * scale, fontWeight: 800, lineHeight: 1.12, margin: `0 0 ${32 * scale}px` }}>{slide.title}</h2>
          {body(40)}
        </Frame>
      );
    case 'cta':
      return (
        <Frame look={look} scale={scale} dark>
          <h2 style={{ fontSize: 84 * scale, fontWeight: 800, lineHeight: 1.1, margin: `0 0 ${32 * scale}px` }}>{slide.title}</h2>
          {body(40, { opacity: 0.9 })}
          {look.website ? (
            <div style={{ display: 'flex', marginTop: 48 * scale }}>
              <span style={{ fontSize: 32 * scale, fontWeight: 700, background: '#FFFFFF', color: look.primary, padding: `${18 * scale}px ${36 * scale}px`, borderRadius: 999 }}>
                {look.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </span>
            </div>
          ) : null}
        </Frame>
      );
    case 'quote':
      return (
        <Frame look={look} scale={scale}>
          <span style={{ fontSize: 220 * scale, fontWeight: 800, color: look.accent, lineHeight: 0.8, height: 120 * scale }}>“</span>
          <p style={{ fontSize: 64 * scale, fontWeight: 700, lineHeight: 1.25, margin: `0 0 ${40 * scale}px` }}>{slide.title}</p>
          {slide.footnote ? <span style={{ fontSize: 34 * scale, fontWeight: 700, color: look.primary }}>— {slide.footnote}</span> : null}
        </Frame>
      );
    case 'announcement':
      return (
        <Frame look={look} scale={scale} footnote={slide.footnote}>
          <Eyebrow text={slide.eyebrow} look={look} scale={scale} />
          <h1 style={{ fontSize: 96 * scale, fontWeight: 800, lineHeight: 1.05, margin: `0 0 ${32 * scale}px` }}>{slide.title}</h1>
          {body(42)}
        </Frame>
      );
    case 'stat':
      return (
        <Frame look={look} scale={scale} footnote={slide.footnote}>
          <Eyebrow text={slide.eyebrow} look={look} scale={scale} />
          <span style={{ fontSize: 240 * scale, fontWeight: 800, lineHeight: 1, color: look.primary, marginBottom: 32 * scale }}>{slide.title}</span>
          {body(48, { opacity: 0.9 })}
        </Frame>
      );
  }
}

export async function renderSlideJpeg(slide: Slide, look: BrandLook, format: GraphicFormat): Promise<Buffer> {
  const { width, height } = GRAPHIC_FORMATS[format];
  const scale = Math.min(width, height) / 1080;
  const response = new ImageResponse(<SlideView slide={slide} look={look} scale={scale} />, { width, height, fonts: await fontsPromise });
  const png = Buffer.from(await response.arrayBuffer());
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Logo as a small PNG data URL for embedding in slides. */
export async function logoDataUrl(imageBytes: ArrayBuffer): Promise<string> {
  const png = await sharp(Buffer.from(imageBytes)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
