'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createUserClient } from '@/lib/supabase/server';

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  mode: z.enum(['signin', 'signup']),
  next: z.string().optional(),
});

export async function authenticate(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, password, mode, next } = parsed.data;
  const supabase = await createUserClient();

  // Only allow same-site relative redirects (e.g. back to an invitation link).
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;

  if (mode === 'signup') {
    const origin = (await headers()).get('origin') ?? '';
    const after = safeNext ?? '/onboarding';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(after)}` },
    });
    if (error) return { error: error.message };
    if (!data.session) return { message: 'Check your email to confirm your account, then sign in.' };
    redirect(after);
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(safeNext ?? '/calendar');
}

/** Signs out; an optional "next" form field returns the user to that page after signing in again. */
export async function signOut(formData?: FormData) {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  const next = formData?.get('next');
  redirect(typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? `/login?next=${encodeURIComponent(next)}` : '/login');
}
