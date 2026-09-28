/** The Brand Brain: facts and voice every agent writes from. Mirrors the brand_profiles table. */
export interface BrandProfile {
  brandName: string;
  website?: string | null;
  description: string;
  audience: string;
  products: string;
  voice: string;
  wordsToUse: string[];
  wordsToAvoid: string[];
  approvedClaims: string[];
  bannedClaims: string[];
  defaultHashtags: string[];
  primaryCta: string;
  examplePosts: string;
}

const section = (title: string, body: string | string[]) => {
  const text = Array.isArray(body) ? body.filter(Boolean).map((b) => `- ${b}`).join('\n') : body.trim();
  return text ? `## ${title}\n${text}` : '';
};

/**
 * Renders the Brand Brain as prompt context. Deterministic output (same profile ->
 * same text) so it can be prompt-cached across requests.
 */
export function brandContext(p: BrandProfile): string {
  return [
    `# Brand: ${p.brandName}${p.website ? ` (${p.website})` : ''}`,
    section('What it is', p.description),
    section('Audience', p.audience),
    section('Products and features (facts)', p.products),
    section('Voice and tone', p.voice),
    section('Words and phrases to use', p.wordsToUse),
    section('Words and phrases to avoid', p.wordsToAvoid),
    section('Approved claims (the only factual claims you may make)', p.approvedClaims),
    section('Never claim', p.bannedClaims),
    section('Default hashtags', p.defaultHashtags),
    section('Primary call to action', p.primaryCta),
    section('Example posts in the right voice', p.examplePosts),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Missing Brand Brain fields that most affect output quality. */
export function brandGaps(p: BrandProfile): string[] {
  const gaps: string[] = [];
  if (!p.description.trim()) gaps.push('description');
  if (!p.audience.trim()) gaps.push('audience');
  if (!p.voice.trim()) gaps.push('voice');
  if (!p.approvedClaims.length) gaps.push('approved claims');
  return gaps;
}
