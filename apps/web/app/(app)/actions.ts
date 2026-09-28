'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { BRAND_COOKIE, getWorkspace, ORG_COOKIE } from '@/lib/workspace';

const COOKIE = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 } as const;

export async function switchBrand(brandId: string) {
  const ws = await getWorkspace();
  if (!ws.brands.some((b) => b.id === brandId)) throw new Error('Brand not found');
  (await cookies()).set(BRAND_COOKIE, brandId, COOKIE);
  revalidatePath('/', 'layout');
}

export async function switchOrg(orgId: string) {
  const ws = await getWorkspace();
  if (!ws.orgs.some((o) => o.id === orgId)) throw new Error('Organization not found');
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, COOKIE);
  jar.delete(BRAND_COOKIE);
  redirect('/calendar');
}
