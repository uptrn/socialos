import 'server-only';

/**
 * How SocialOS runs (APP_MODE):
 * - 'company' (default): one company's own tool. Billing is off, every brand gets everything, and
 *   sign-up is invite-only (platform admins can create the company; others need an invitation).
 * - 'saas': the subscription product: public sign-up, free trial, plans and Stripe billing.
 */
export function isSaasMode(): boolean {
  return process.env.APP_MODE === 'saas';
}

export function isCompanyMode(): boolean {
  return !isSaasMode();
}
