import { describe, expect, it } from 'vitest';
import {
  assembleCaption,
  brandContext,
  brandGaps,
  checkBrandRules,
  contentSystemPrompt,
  contentUserPrompt,
  finalizeDrafts,
  finalizeResearch,
  researchBrief,
  researchUserPrompt,
  structureUserPrompt,
  type BrandProfile,
  type ContentRequest,
} from '../src';

const profile: BrandProfile = {
  brandName: 'Clear Builders',
  website: 'https://clearbuilders.example',
  description: 'Invoicing and job tracking for contractors.',
  audience: 'Small construction firms, 1-20 people.',
  products: 'Invoices, estimates, job costing.',
  voice: 'Plain, practical, friendly.',
  wordsToUse: ['crew', 'job site'],
  wordsToAvoid: ['synergy', 'revolutionary'],
  approvedClaims: ['Free 14-day trial', 'No credit card needed to start'],
  bannedClaims: ['guaranteed to double revenue'],
  defaultHashtags: ['contractors'],
  primaryCta: 'Start your free trial',
  examplePosts: '',
};

describe('brand context', () => {
  it('renders facts, omits empty sections, and is deterministic', () => {
    const text = brandContext(profile);
    expect(text).toContain('# Brand: Clear Builders (https://clearbuilders.example)');
    expect(text).toContain('- Free 14-day trial');
    expect(text).not.toContain('Example posts');
    expect(brandContext(profile)).toBe(text);
    expect(contentSystemPrompt(profile)).toBe(contentSystemPrompt({ ...profile }));
  });

  it('reports missing essentials', () => {
    expect(brandGaps({ ...profile, voice: '', approvedClaims: [] })).toEqual(['voice', 'approved claims']);
  });
});

describe('content agent helpers', () => {
  const req: ContentRequest = {
    brief: 'Announce job costing reports',
    goal: 'signups',
    link: 'https://clearbuilders.example/reports',
    targets: [
      { key: 'acc-x', platform: 'x', postType: 'text' },
      { key: 'acc-ig', platform: 'instagram', postType: 'image' },
      { key: 'acc-story', platform: 'instagram', postType: 'story' },
    ],
  };

  it('describes each target with its limits', () => {
    const prompt = contentUserPrompt(req);
    expect(prompt).toContain('key "acc-x": X text, up to 280 characters (threads allowed)');
    expect(prompt).toContain('max 30 hashtags');
    expect(prompt).toContain('caption is not shown');
  });

  it('assembles hashtags without duplicates', () => {
    expect(assembleCaption('Hello #crew', ['#crew', 'contractors', ' job site '])).toBe('Hello #crew\n\n#contractors #jobsite');
  });

  it('drops hashtags to fit the limit and never truncates the text', () => {
    const text = 'x'.repeat(270);
    const [draft] = finalizeDrafts(
      { ...req, targets: [req.targets[0]!] },
      { drafts: [{ key: 'acc-x', caption: text, hashtags: ['one', 'two', 'three'], threadParts: ['more'], youtubeTitle: '' }], assumptions: [] },
    );
    expect(draft!.caption).toBe(`${text}\n\n#one`);
    expect(draft!.threadParts).toEqual(['more']);
  });

  it('caps Instagram hashtags, blanks story captions and ignores unknown keys', () => {
    const drafts = finalizeDrafts(req, {
      drafts: [
        { key: 'acc-ig', caption: 'Post', hashtags: Array.from({ length: 35 }, (_, i) => `t${i}`), threadParts: ['x'], youtubeTitle: '' },
        { key: 'acc-story', caption: 'ignored', hashtags: [], threadParts: [], youtubeTitle: '' },
        { key: 'unknown', caption: 'ignored', hashtags: [], threadParts: [], youtubeTitle: '' },
      ],
      assumptions: [],
    });
    expect(drafts.map((d) => d.key)).toEqual(['acc-ig', 'acc-story']);
    expect(drafts[0]!.caption.match(/#/g)).toHaveLength(30);
    expect(drafts[0]!.threadParts).toEqual([]); // Instagram has no threads
    expect(drafts[1]!.caption).toBe('');
  });
});

describe('brand rule checks', () => {
  it('flags avoided words as whole words and banned claims', () => {
    const findings = checkBrandRules('A revolutionary tool, guaranteed to double revenue! Synergyish is fine.', profile);
    expect(findings.map((f) => [f.severity, f.quote])).toEqual([
      ['warning', 'revolutionary'],
      ['error', 'guaranteed to double revenue'],
    ]);
  });
});


describe('research agent helpers', () => {
  const found = [
    { url: 'https://news.example/a', title: 'A' },
    { url: 'https://blog.example/b/', title: 'B', published: '2 days ago' },
  ];
  const item = (over: Record<string, unknown>) => ({
    topic: 'T', summary: 'S', whyRelevant: 'W', angle: 'Angle', kind: 'news' as const, platforms: ['linkedin' as const],
    format: 'carousel', priority: 7, risk: 'low' as const, sourceUrls: ['https://news.example/a'], ...over,
  });

  it('keeps only real sources, drops unsourced items and duplicates, sorts by priority', () => {
    const items = finalizeResearch(
      {
        items: [
          item({ topic: 'Low', priority: 3, sourceUrls: ['https://blog.example/b?utm_source=x'] }),
          item({ topic: 'Invented link', sourceUrls: ['https://made-up.example/'] }),
          item({ topic: 'High', priority: 14 }),
          item({ topic: 'high', priority: 9 }),
        ],
      },
      found,
    );
    expect(items.map((i) => [i.topic, i.priority])).toEqual([['High', 10], ['Low', 3]]);
    expect(items[1]!.sources).toEqual([found[1]]);
  });

  it('builds prompts with date, keywords, competitors and numbered sources', () => {
    const p = researchUserPrompt({ keywords: ['invoicing'], competitors: ['Acme'] }, new Date('2026-09-26T10:00:00Z'));
    expect(p).toContain("Today's date: 2026-09-26.");
    expect(p).toContain('Competitors to watch: Acme.');
    expect(structureUserPrompt('notes', found)).toContain('2. B — https://blog.example/b/ (2 days ago)');
    expect(researchBrief({ topic: 'T', angle: 'Say X', summary: 'S' })).toBe('Say X\n\nContext: T — S');
  });
});
