/**
 * Company details used on the public legal pages. Set these before submitting apps to Meta, Google,
 * LinkedIn, X and TikTok. The legal texts are templates: have them reviewed by a lawyer.
 */
export const LEGAL = {
  product: 'SocialOS',
  company: process.env.LEGAL_COMPANY_NAME || '[Company legal name]',
  email: process.env.LEGAL_CONTACT_EMAIL || '[privacy contact email]',
  address: process.env.LEGAL_ADDRESS || '[Registered address]',
  jurisdiction: process.env.LEGAL_JURISDICTION || '[Country / state]',
  effectiveDate: process.env.LEGAL_EFFECTIVE_DATE || '[Effective date]',
};

export function legalConfigured(): boolean {
  return !!(process.env.LEGAL_COMPANY_NAME && process.env.LEGAL_CONTACT_EMAIL && process.env.LEGAL_ADDRESS && process.env.LEGAL_JURISDICTION);
}
