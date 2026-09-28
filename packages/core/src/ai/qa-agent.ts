import { z } from 'zod';
import { brandContext, type BrandProfile } from './brand';

// QA: checks a draft against the Brand Brain before it goes out. Two layers:
// 1. deterministic checks (always run, free): banned words and claims
// 2. model review: unsupported claims, off-brand tone, risky statements

export interface QaFinding {
  severity: 'error' | 'warning';
  quote: string;
  problem: string;
  suggestion?: string;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Flags any "avoid" word or banned claim that appears in the text (case-insensitive). */
export function checkBrandRules(text: string, profile: Pick<BrandProfile, 'wordsToAvoid' | 'bannedClaims'>): QaFinding[] {
  const haystack = normalize(text);
  const findings: QaFinding[] = [];
  for (const word of profile.wordsToAvoid) {
    const w = normalize(word);
    if (!w) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
    if (re.test(haystack)) findings.push({ severity: 'warning', quote: word, problem: `"${word}" is on the brand's avoid list.` });
  }
  for (const claim of profile.bannedClaims) {
    const c = normalize(claim);
    if (c && haystack.includes(c)) findings.push({ severity: 'error', quote: claim, problem: 'This is on the brand\'s "never claim" list.' });
  }
  return findings;
}

export const qaOutputSchema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(['error', 'warning']).describe('error = must fix before posting; warning = worth a look'),
      quote: z.string().describe('The exact words from the post this is about'),
      problem: z.string(),
      suggestion: z.string().describe('A replacement for the quoted words, or empty'),
    }),
  ),
});
export type QaOutput = z.infer<typeof qaOutputSchema>;

const QA_INSTRUCTIONS = `You review social media posts for one brand before they are published. The brand's facts and
rules are below.

Report only real problems, quoting the exact words:
- error: a factual claim (feature, price, number, result, comparison, guarantee) that the brand facts don't
  support; anything on the "Never claim" list; statements that could be misleading, legally risky, or
  promise something the brand hasn't approved.
- warning: off-brand tone, words the brand avoids, unclear wording, or a missing call to action when the
  goal needs one.

If the post is fine, return no findings. Don't rewrite the whole post and don't comment on style
preferences the brand facts don't express.`;

export function qaSystemPrompt(profile: BrandProfile): string {
  return `${QA_INSTRUCTIONS}\n\n${brandContext(profile)}`;
}

export function qaUserPrompt(platformLabel: string, text: string): string {
  return `Platform: ${platformLabel}\n\nPost:\n"""\n${text}\n"""`;
}
