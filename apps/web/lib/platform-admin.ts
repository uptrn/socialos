import 'server-only';
import { notFound } from 'next/navigation';
import { requireUser } from './workspace';

/** SocialOS staff, by confirmed email address (PLATFORM_ADMIN_EMAILS, comma separated). */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isPlatformAdmin(): Promise<boolean> {
  const user = await requireUser();
  return !!user.email && !!user.email_confirmed_at && platformAdminEmails().includes(user.email.toLowerCase());
}

/** For admin pages and actions: 404 for everyone else, so the console isn't discoverable. */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.email || !user.email_confirmed_at || !platformAdminEmails().includes(user.email.toLowerCase())) notFound();
  return user;
}
