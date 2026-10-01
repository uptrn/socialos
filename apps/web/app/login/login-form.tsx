'use client';

import { useActionState, useState } from 'react';
import { Button, Card, Field, inputClass } from '@/components/ui';
import { authenticate, type AuthState } from './actions';

export function LoginForm({ next, initialMode = 'signin', inviteOnly = false }: { next?: string; initialMode?: 'signin' | 'signup'; inviteOnly?: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [state, action, pending] = useActionState<AuthState, FormData>(authenticate, {});

  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === 'signin' ? 'Welcome back to SocialOS.' : inviteOnly ? 'Use the email address your invitation was sent to.' : 'Start scheduling posts for your brands.'}
      </p>
      {next?.startsWith('/invite/') && (
        <p className="mt-3 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">
          You&apos;re joining a team. Sign in, or create an account, with the email address the invitation was sent to.
        </p>
      )}

      <form action={action} className="mt-6 space-y-4">
        <input type="hidden" name="mode" value={mode} />
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            className={inputClass}
          />
        </Field>

        {state.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{state.message}</p>}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
        {mode === 'signup' && (
          <p className="text-center text-xs text-muted">
            By creating an account you agree to the{' '}
            <a href="/legal/terms" target="_blank" className="underline hover:text-text">
              Terms
            </a>{' '}
            and{' '}
            <a href="/legal/privacy" target="_blank" className="underline hover:text-text">
              Privacy Policy
            </a>
            .
          </p>
        )}
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {mode === 'signin' ? (inviteOnly ? 'Invited to SocialOS?' : 'New to SocialOS?') : 'Already have an account?'}{' '}
        <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </Card>
  );
}
