import type { Metadata } from 'next';
import { Logo } from '@/components/ui';
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
        <LoginForm next={typeof next === 'string' ? next : undefined} initialMode={mode === 'signup' ? 'signup' : 'signin'} />
      </div>
    </main>
  );
}
