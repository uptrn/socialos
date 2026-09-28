import { describe, expect, it } from 'vitest';
import { campaignSlug, findUrls, isBotUserAgent, isValidEventName, isValidLinkCode, newLinkCode, rewriteLinks, utmFor, withUtms } from '../src';

describe('tracked links', () => {
  it('finds URLs without trailing punctuation and removes duplicates', () => {
    expect(findUrls('See https://acme.com/pricing. Or (https://acme.com/demo?x=1), again https://acme.com/pricing!')).toEqual([
      'https://acme.com/pricing',
      'https://acme.com/demo?x=1',
    ]);
    expect(findUrls('no links, ftp://x.y and http:// alone')).toEqual([]);
  });

  it('adds UTMs without overriding the author’s', () => {
    const utm = utmFor({ platform: 'linkedin', campaign: 'spring-launch', content: 'v1' });
    const url = new URL(withUtms('https://acme.com/p?utm_campaign=own&ref=1#top', utm));
    expect(url.searchParams.get('utm_source')).toBe('linkedin');
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('own');
    expect(url.searchParams.get('utm_content')).toBe('v1');
    expect(url.searchParams.get('ref')).toBe('1');
    expect(url.hash).toBe('#top');
    expect(withUtms('not a url', utm)).toBe('not a url');
  });

  it('makes campaign slugs', () => {
    expect(campaignSlug('Spring Launch — Café 2026!')).toBe('spring-launch-cafe-2026');
    expect(campaignSlug('')).toBe('social');
  });

  it('rewrites links, longest first, and keeps the original when over the limit', () => {
    const links = new Map([
      ['https://acme.com', 'https://sos.test/l/aaaaaaa'],
      ['https://acme.com/pricing', 'https://sos.test/l/bbbbbbb'],
    ]);
    expect(rewriteLinks('Go https://acme.com/pricing or https://acme.com', links, 'linkedin', 'text')).toBe('Go https://sos.test/l/bbbbbbb or https://sos.test/l/aaaaaaa');
    const long = new Map([['https://a.co', `https://sos.test/l/${'x'.repeat(600)}`]]);
    expect(rewriteLinks('Hi https://a.co', long, 'threads', 'text')).toBe('Hi https://a.co');
    // X counts every URL as 23 characters, so longer tracked links still fit.
    expect(rewriteLinks(`${'y'.repeat(250)} https://a.co`, long, 'x', 'text')).toContain('/l/');
  });

  it('generates valid codes', () => {
    const codes = new Set(Array.from({ length: 500 }, () => newLinkCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(isValidLinkCode(c)).toBe(true);
    expect(isValidLinkCode('../etc')).toBe(false);
  });

  it('spots bots and checks event names', () => {
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('LinkedInBot/1.0')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe(false);
    expect(isValidEventName('trial_started')).toBe(true);
    expect(isValidEventName('Purchase!')).toBe(false);
  });
});
