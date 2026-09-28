import { z } from 'zod';
import { brandContext, type BrandProfile } from './brand';

// Creative agent, part 1: branded graphics from templates. The model only writes slide text;
// the app renders it with the brand's colors, font and logo, so output is always on-brand.

export const GRAPHIC_TEMPLATES = {
  carousel: { label: 'Carousel (tips / steps)', minSlides: 3, maxSlides: 10 },
  quote: { label: 'Quote card', minSlides: 1, maxSlides: 1 },
  announcement: { label: 'Announcement', minSlides: 1, maxSlides: 1 },
  stat: { label: 'Big number', minSlides: 1, maxSlides: 1 },
} as const;
export type GraphicTemplate = keyof typeof GRAPHIC_TEMPLATES;

export const GRAPHIC_FORMATS = {
  square: { label: 'Square 1:1', width: 1080, height: 1080 },
  portrait: { label: 'Portrait 4:5', width: 1080, height: 1350 },
  story: { label: 'Story / Reel cover 9:16', width: 1080, height: 1920 },
  landscape: { label: 'Landscape 1.91:1', width: 1200, height: 628 },
} as const;
export type GraphicFormat = keyof typeof GRAPHIC_FORMATS;

export type SlideLayout = 'cover' | 'point' | 'cta' | 'quote' | 'announcement' | 'stat';

export interface Slide {
  layout: SlideLayout;
  eyebrow: string; // small label above the title
  title: string;
  body: string;
  footnote: string; // attribution, source, or step number
}

/** Character limits that keep text readable at 1080px. Checked after the model writes. */
export const SLIDE_LIMITS = { eyebrow: 40, title: 70, body: 220, footnote: 80 } as const;

export function slideIssues(slide: Slide): string[] {
  return (Object.keys(SLIDE_LIMITS) as (keyof typeof SLIDE_LIMITS)[])
    .filter((k) => slide[k].length > SLIDE_LIMITS[k])
    .map((k) => `${k} is ${slide[k].length} characters (max ${SLIDE_LIMITS[k]})`);
}

export const graphicsOutputSchema = z.object({
  slides: z.array(
    z.object({
      layout: z.enum(['cover', 'point', 'cta', 'quote', 'announcement', 'stat']),
      eyebrow: z.string(),
      title: z.string(),
      body: z.string(),
      footnote: z.string(),
    }),
  ),
});

const LAYOUT_GUIDE: Record<GraphicTemplate, string> = {
  carousel:
    'A carousel: first slide layout "cover" (a title that makes people swipe, short body as subtitle), then 1-8 "point" slides (one idea each: short title, 1-2 sentence body, footnote like "1/5"), last slide "cta" (title = the call to action, body = one supporting line).',
  quote: 'One slide, layout "quote": title = the quote (no quotation marks), footnote = who said it. Only use a real quote given in the brief.',
  announcement: 'One slide, layout "announcement": eyebrow like "New" or "Coming soon", title = the news, body = one line of detail, footnote = call to action or date.',
  stat: 'One slide, layout "stat": title = the number exactly as it appears in the brand facts or brief (e.g. "3x", "12,000"), body = what it measures, footnote = the source. Never invent a number.',
};

export function graphicsSystemPrompt(profile: BrandProfile): string {
  return `You write the text for branded social media graphics. The brand's facts and voice are below.

Graphics are read in a second or two: short, concrete, no filler. Keep every field within its limit
(eyebrow ${SLIDE_LIMITS.eyebrow}, title ${SLIDE_LIMITS.title}, body ${SLIDE_LIMITS.body}, footnote ${SLIDE_LIMITS.footnote} characters).
Leave a field empty rather than padding it. Only state facts from the brand facts or the brief; never
use anything under "Never claim". No hashtags or emojis on the graphic.

${brandContext(profile)}`;
}

export function graphicsUserPrompt(template: GraphicTemplate, brief: string, slideCount?: number): string {
  const count = template === 'carousel' && slideCount ? ` Use ${slideCount} slides in total.` : '';
  return `${LAYOUT_GUIDE[template]}${count}\n\nBrief: ${brief.trim()}`;
}

/** Normalizes model output to the template's slide count and layouts. */
export function finalizeSlides(template: GraphicTemplate, slides: Slide[]): Slide[] {
  const { minSlides, maxSlides } = GRAPHIC_TEMPLATES[template];
  const clean = slides.map((s) => ({
    layout: s.layout,
    eyebrow: s.eyebrow.trim(),
    title: s.title.trim().replace(/^["“”]+|["“”]+$/g, ''),
    body: s.body.trim(),
    footnote: s.footnote.trim(),
  }));
  if (template !== 'carousel') {
    const layout: SlideLayout = template;
    return clean.slice(0, 1).map((s) => ({ ...s, layout }));
  }
  const limited = clean.slice(0, maxSlides);
  if (limited.length < minSlides) return limited;
  // Carousel: first is the cover, last is the call to action, the rest are points.
  return limited.map((s, i) => ({ ...s, layout: i === 0 ? 'cover' : i === limited.length - 1 ? 'cta' : 'point' }));
}

export function emptySlides(template: GraphicTemplate): Slide[] {
  const blank = { eyebrow: '', title: '', body: '', footnote: '' };
  if (template === 'carousel') {
    return [
      { ...blank, layout: 'cover', title: 'Your headline' },
      { ...blank, layout: 'point', title: 'First point', footnote: '1/3' },
      { ...blank, layout: 'point', title: 'Second point', footnote: '2/3' },
      { ...blank, layout: 'cta', title: 'Your call to action' },
    ];
  }
  return [{ ...blank, layout: template, title: template === 'stat' ? '10x' : 'Your text' }];
}
