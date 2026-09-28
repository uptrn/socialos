import { describe, expect, it } from 'vitest';
import { emptySlides, finalizeSlides, graphicsUserPrompt, slideIssues, type Slide } from '../src';

const s = (over: Partial<Slide>): Slide => ({ layout: 'point', eyebrow: '', title: 'T', body: '', footnote: '', ...over });

describe('graphics agent helpers', () => {
  it('forces carousel structure: cover first, CTA last, points between; caps at 10', () => {
    const slides = finalizeSlides('carousel', Array.from({ length: 12 }, (_, i) => s({ layout: 'quote', title: `S${i}` })));
    expect(slides).toHaveLength(10);
    expect(slides.map((x) => x.layout)).toEqual(['cover', ...Array(8).fill('point'), 'cta']);
  });

  it('keeps one slide for single-slide templates and strips quotation marks', () => {
    const [quote] = finalizeSlides('quote', [s({ title: '“Build less, ship more”' }), s({})]);
    expect(quote).toMatchObject({ layout: 'quote', title: 'Build less, ship more' });
  });

  it('reports fields over the readable limit', () => {
    expect(slideIssues(s({ title: 'x'.repeat(71) }))).toEqual(['title is 71 characters (max 70)']);
  });

  it('asks for a slide count and gives starter slides', () => {
    expect(graphicsUserPrompt('carousel', 'Invoice tips', 6)).toContain('Use 6 slides in total.');
    expect(emptySlides('carousel').map((x) => x.layout)).toEqual(['cover', 'point', 'point', 'cta']);
    expect(emptySlides('stat')[0]!.layout).toBe('stat');
  });
});
