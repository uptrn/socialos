'use client';

import { Check, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { Button, Field, inputClass } from '@/components/ui';
import type { Role } from '@/lib/workspace';
import { changeRole, inviteMember, removeMember, resendInvite, revokeInvite, type InviteState } from './actions';

const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', reviewer: 'Reviewer', viewer: 'Viewer' };

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={link} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function InviteResult({ state }: { state: InviteState }) {
  if (state.error) return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>;
  if (!state.link) return null;
  return (
    <div className="space-y-2 rounded-lg bg-success/10 px-3 py-3 text-sm">
      <p className="text-success">
        {state.emailed ? `Invitation emailed to ${state.email}.` : `Invitation created. Email isn't set up yet, so send this link to ${state.email} yourself:`}
      </p>
      {!state.emailed && <CopyLink link={state.link} />}
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <Field label="Email">
          <input name="email" type="email" required className={inputClass} placeholder="name@company.com" />
        </Field>
        <Field label="Role">
          <select name="role" defaultValue="manager" className={inputClass}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Inviting…' : 'Send invite'}
        </Button>
      </div>
      <InviteResult state={state} />
    </form>
  );
}

export function MemberRow(props: { userId: string; email: string; role: Role; joined: string; isSelf: boolean; canEdit: boolean; canMakeOwner: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();
  const roles = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => props.canMakeOwner || r !== 'owner');

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setError(res.error);
      if (!res.error) after?.();
    });

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {props.email} {props.isSelf && <span className="text-muted">(you)</span>}
          </p>
          <p className="text-xs text-muted">Joined {props.joined}</p>
        </div>
        {props.canEdit ? (
          <select
            value={props.role}
            disabled={pending}
            onChange={(e) => run(() => changeRole(props.userId, e.target.value))}
            aria-label={`Role for ${props.email}`}
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted">{ROLE_LABELS[props.role]}</span>
        )}
        {(props.canEdit || props.isSelf) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              const question = props.isSelf ? 'Leave this organization? You will lose access to it.' : `Remove ${props.email} from the team?`;
              if (!window.confirm(question)) return;
              run(() => removeMember(props.userId), () => (props.isSelf ? router.push('/calendar') : router.refresh()));
            }}
          >
            {props.isSelf ? 'Leave' : 'Remove'}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  );
}

export function InviteRow({ id, email, role, expired, sent }: { id: string; email: string; role: string; expired: boolean; sent: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<InviteState>({});

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{email}</p>
          <p className="text-xs text-muted">
            {role} · sent {sent}
            {expired && <span className="text-warning"> · expired</span>}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => setResult(await resendInvite(id)))}>
          {expired ? 'Send new link' : 'Resend'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => setResult(await revokeInvite(id)))}>
          Cancel
        </Button>
      </div>
      <div className="mt-2">
        <InviteResult state={result} />
      </div>
    </li>
  );
}
