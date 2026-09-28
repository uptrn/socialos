import 'server-only';
import { isValidEventName } from '@socialos/core';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createAdminClient } from './supabase/server';

export const conversionSchema = z.object({
  event: z.string().refine(isValidEventName, 'event must be lowercase letters, numbers and _ (e.g. "signup")'),
  click_id: z.string().uuid().optional(),
  value: z.number().nonnegative().max(1e10).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter code like USD').optional(),
  id: z.string().max(200).optional(),
});

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** A new server key for the conversions API. Only its hash is stored. */
export function newServerKey(): { key: string; hash: string } {
  const key = `sos_sk_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashSecret(key) };
}

export async function recordConversion(
  brandId: string,
  input: z.infer<typeof conversionSchema>,
  source: 'snippet' | 'server',
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('record_conversion', {
    p_brand: brandId,
    p_click: input.click_id ?? null,
    p_event: input.event,
    p_value: input.value ?? null,
    p_currency: input.currency ?? null,
    p_external_id: input.id ?? null,
    p_source: source,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
