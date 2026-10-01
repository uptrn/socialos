import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import { isCompanyMode } from '@/lib/mode';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, mode } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo width={196} />
        </div>
        <LoginForm next={typeof next === 'string' ? next : undefined} initialMode={mode === 'signup' ? 'signup' : 'signin'} inviteOnly={isCompanyMode()} />
        <p className="mt-6 flex justify-center gap-4 text-xs text-muted">
          <Link href="/legal/privacy" className="hover:text-text">
            Privacy
          </Link>
          <Link href="/legal/terms" className="hover:text-text">
            Terms
          </Link>
          <Link href="/legal/data-deletion" className="hover:text-text">
            Data deletion
          </Link>
        </p>
      </div>
    </main>
  );
}
