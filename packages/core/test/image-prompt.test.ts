import { describe, expect, it } from 'vitest';
import { buildImagePrompt, coverCrop, OPENAI_SIZE } from '../src';

const brand = { name: 'Clear Builders', visualStyle: 'bright flat illustration', primary: '#1453F5', accent: '#0BC3F5' };

describe('image prompt', () => {
  it('adds style, colors and a no-text rule by default', () => {
    const p = buildImagePrompt('A contractor reviewing invoices on a tablet at a job site', brand);
    expect(p).toContain('job site. Style: bright flat illustration.');
    expect(p).toContain('#1453F5 and #0BC3F5');
    expect(p).toContain('Do not include any text');
  });

  it('allows exact text when requested and skips an empty style', () => {
    const p = buildImagePrompt('A sign saying "Open"', { ...brand, visualStyle: '' }, { allowText: true });
    expect(p).not.toContain('Style:');
    expect(p).toContain('spelled exactly');
  });
});

describe('sizes and cropping', () => {
  it('uses OpenAI custom sizes that meet its rules', () => {
    for (const size of Object.values(OPENAI_SIZE)) {
      const [w, h] = size.split('x').map(Number) as [number, number];
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w / h).toBeGreaterThanOrEqual(1 / 3);
      expect(w / h).toBeLessThanOrEqual(3);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
    }
  });

  it('center-crops a square to portrait and landscape', () => {
    expect(coverCrop(1024, 1024, 1080, 1350)).toEqual({ left: 103, top: 0, width: 819, height: 1024 });
    expect(coverCrop(1024, 1024, 1200, 628)).toEqual({ left: 0, top: 244, width: 1024, height: 536 });
  });
});
