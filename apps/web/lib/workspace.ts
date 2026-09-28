import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createUserClient } from './supabase/server';

export type Role = 'owner' | 'admin' | 'manager' | 'reviewer' | 'viewer';
export const EDITOR_ROLES: Role[] = ['owner', 'admin', 'manager'];
/** Can approve posts when a brand requires approval (owners and admins also schedule without it). */
export const APPROVER_ROLES: Role[] = ['owner', 'admin', 'reviewer'];

export interface Brand {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  timezone: string;
  /** Posts by managers need approval before they're scheduled. */
  require_approval: boolean;
}

export interface Workspace {
  userId: string;
  email: string | null;
  org: { id: string; name: string };
  /** All organizations the user belongs to. */
  orgs: { id: string; name: string }[];
  role: Role;
  brands: Brand[];
  brand: Brand;
  canEdit: boolean;
  canApprove: boolean;
}

export const BRAND_COOKIE = 'sos_brand';
export const ORG_COOKIE = 'sos_org';

export const requireUser = cache(async () => {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return data.user;
});

/** The signed-in user's current organization and brand. Redirects to onboarding if they have none. */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  const user = await requireUser();
  const supabase = await createUserClient();

  const { data: memberships, error } = await supabase
    .from('org_members')
    .select('role, organizations(id, name)')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (error) throw error;
  if (!memberships?.length) redirect('/onboarding');

  // A user can belong to several organizations (e.g. their own and one they were invited to).
  const orgs = memberships.map((m) => ({ ...(m.organizations as unknown as { id: string; name: string }), role: m.role as Role }));
  const selectedOrg = (await cookies()).get(ORG_COOKIE)?.value;
  const membership = orgs.find((o) => o.id === selectedOrg) ?? orgs[0]!;
  const org = { id: membership.id, name: membership.name };

  const { data: brands } = await supabase
    .from('brands')
    .select('id, org_id, name, slug, timezone, require_approval')
    .eq('org_id', org.id)
    .eq('status', 'active')
    .order('created_at');
  if (!brands?.length) redirect('/onboarding');

  const selected = (await cookies()).get(BRAND_COOKIE)?.value;
  const brand = brands.find((b) => b.id === selected) ?? brands[0]!;
  const role = membership.role as Role;

  return {
    userId: user.id,
    email: user.email ?? null,
    org,
    orgs: orgs.map(({ id, name }) => ({ id, name })),
    role,
    brands,
    brand,
    canEdit: EDITOR_ROLES.includes(role),
    canApprove: APPROVER_ROLES.includes(role),
  };
});

/** Whether this user's scheduling in this brand has to go through approval. */
export function needsApproval(ws: Pick<Workspace, 'role'>, brand: Pick<Brand, 'require_approval'>): boolean {
  return brand.require_approval && !APPROVER_ROLES.includes(ws.role);
}

/** For server actions: throws unless the user can edit content in the brand's organization. */
export async function requireBrandEditor(brandId: string): Promise<Workspace & { brand: Brand }> {
  const ws = await getWorkspace();
  const brand = ws.brands.find((b) => b.id === brandId);
  if (!brand) throw new Error('Brand not found');
  if (!ws.canEdit) throw new Error('You do not have permission to edit content');
  return { ...ws, brand };
}
