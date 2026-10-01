'use server';

import { isValidTimeZone } from '@socialos/core';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isCompanyMode } from '@/lib/mode';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { createUserClient } from '@/lib/supabase/server';

const schema = z.object({
  orgName: z.string().trim().min(2, 'Enter your company name').max(120),
  brandName: z.string().trim().min(2, 'Enter your first brand name').max(120),
  timezone: z.string().refine(isValidTimeZone, 'Choose a valid timezone'),
});

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'org';
}

export async function createWorkspace(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { orgName, brandName, timezone } = parsed.data;
  if (isCompanyMode() && !(await isPlatformAdmin())) {
    return { error: 'SocialOS is invite-only. Ask your administrator for an invitation.' };
  }

  const supabase = await createUserClient();
  // Random suffix keeps org slugs unique without a lookup.
  const slug = `${slugify(orgName)}-${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.rpc('create_organization', {
    p_name: orgName,
    p_slug: slug,
    p_brand_name: brandName,
    p_timezone: timezone,
  });
  if (error) return { error: error.message };
  redirect('/accounts');
}
