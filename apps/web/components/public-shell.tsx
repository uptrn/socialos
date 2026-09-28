import Link from 'next/link';
import { LEGAL } from '@/lib/legal';
import { Logo, buttonClass } from './ui';

/** Header and footer for public (signed-out) pages. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="SocialOS home">
            <Logo width={140} />
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/login" className={buttonClass('ghost', 'sm')}>
              Sign in
            </Link>
            <Link href="/login?mode=signup" className={buttonClass('primary', 'sm')}>
              Start free trial
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <p>
            © {LEGAL.company}. {LEGAL.product}
          </p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/legal/privacy" className="hover:text-text">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-text">
              Terms
            </Link>
            <Link href="/legal/data-deletion" className="hover:text-text">
              Data deletion
            </Link>
            <a href={`mailto:${LEGAL.email}`} className="hover:text-text">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
