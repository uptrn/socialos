import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/platform-admin';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" aria-label="Admin home">
              <Logo width={120} />
            </Link>
            <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">Platform admin</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted">
            <span className="hidden sm:inline">{admin.email}</span>
            <Link href="/calendar" className="hover:text-text">
              Back to app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
