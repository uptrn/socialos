import { z } from 'zod';
import { brandContext, type BrandProfile } from './brand';

// Reply assistant: drafts short replies to a comment in the brand's voice. A person always
// picks, edits and sends; the model never posts on its own.

export const replyOutputSchema = z.object({
  suggestions: z
    .array(z.object({ text: z.string().describe('The reply, ready to post'), approach: z.string().describe('A few words, e.g. "answer + link", "thank"') }))
    .min(1)
    .max(3),
  needsHuman: z.boolean().describe('True for complaints, legal/safety/medical/financial issues, refunds, personal data, or anything the brand facts cannot answer'),
  reason: z.string().describe('Why a person should handle it, or empty'),
});
export type ReplyOutput = z.infer<typeof replyOutputSchema>;

const INSTRUCTIONS = `You draft replies to comments on one brand's social media posts. The brand's facts and rules are below.

Rules:
- Write 1 to 3 short alternative replies in the brand's voice, fit for the platform (no hashtags; at most one emoji
  if the brand uses them).
- Answer only with facts from the brand facts. Never invent prices, dates, features, policies or promises. If the
  answer isn't in the facts, say you'll follow up or point to the brand's contact/website, and set needsHuman.
- Never ask for or repeat personal data in public; invite the person to a private channel instead.
- Complaints, angry comments, refunds, legal, safety, medical or financial questions: set needsHuman, and offer a
  calm reply that acknowledges and moves the conversation to a private channel.
- Spam or abuse: set needsHuman with reason "spam or abuse" and suggest a neutral reply or none-needed wording.
- Keep replies under 400 characters. Match the language of the comment.`;

export function replySystemPrompt(profile: BrandProfile): string {
  return `${INSTRUCTIONS}\n\n${brandContext(profile)}`;
}

export function replyUserPrompt(input: { platformLabel: string; postCaption: string; thread: { author: string; text: string; fromBrand: boolean }[]; comment: { author: string; text: string } }): string {
  const thread = input.thread.length
    ? `Earlier in this thread:\n${input.thread.map((t) => `- ${t.fromBrand ? 'Brand' : t.author}: "${t.text.slice(0, 500)}"`).join('\n')}\n\n`
    : '';
  return `Platform: ${input.platformLabel}
Post caption: """${input.postCaption.slice(0, 1500)}"""

${thread}Comment to answer, from ${input.comment.author}:
"""${input.comment.text.slice(0, 2000)}"""`;
}
