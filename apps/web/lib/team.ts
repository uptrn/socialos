import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from './workspace';

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including billing and managing owners.' },
  admin: { label: 'Admin', description: 'Everything except managing owners: team, brands, accounts, billing.' },
  manager: { label: 'Manager', description: 'Creates, schedules and publishes content; uses AI tools.' },
  reviewer: { label: 'Reviewer', description: 'Approves or rejects posts waiting for approval; cannot change content.' },
  viewer: { label: 'Viewer', description: 'Read-only access.' },
};

export const INVITABLE_ROLES = ['admin', 'manager', 'reviewer', 'viewer'] as const;

/** A new invitation token (goes in the link) and its hash (stored). */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function inviteUrl(token: string): string {
  return `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}`;
}
