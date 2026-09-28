'use client';

import clsx from 'clsx';
import { BookOpenText, CalendarDays, ChartColumn, Gauge, Images, LayoutTemplate, ListChecks, LogOut, MessagesSquare, PenSquare, Plug, Settings, ShieldAlert, ShieldCheck, Telescope, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Logo, LogoMark } from '@/components/ui';
import { signOut } from '../login/actions';
import { switchBrand, switchOrg } from './actions';

const NAV = [
  { href: '/research', label: 'Research', icon: Telescope },
  { href: '/compose', label: 'Compose', icon: PenSquare },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/queue', label: 'Queue', icon: ListChecks },
  { href: '/inbox', label: 'Inbox', icon: MessagesSquare },
  { href: '/analytics', label: 'Analytics', icon: ChartColumn },
  { href: '/creative', label: 'Creative', icon: LayoutTemplate },
  { href: '/media', label: 'Media', icon: Images },
  { href: '/brand', label: 'Brand Brain', icon: BookOpenText },
  { href: '/accounts', label: 'Accounts', icon: Plug },
  { href: '/usage', label: 'AI usage', icon: Gauge },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  orgName,
  orgId,
  orgs,
  email,
  brands,
  currentBrandId,
  approvals,
  inboxOpen = 0,
  platformAdmin = false,
}: {
  orgName: string;
  orgId: string;
  orgs: { id: string; name: string }[];
  email: string | null;
  brands: { id: string; name: string }[];
  currentBrandId: string;
  /** Shown when the brand uses approvals or has posts waiting. */
  approvals?: { count: number };
  /** Comments waiting for a reply. */
  inboxOpen?: number;
  /** SocialOS staff: show the link to the platform admin console. */
  platformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-border bg-surface md:w-60">
      <div className="flex h-16 items-center px-3 md:px-5">
        <span className="md:hidden">
          <LogoMark size={32} />
        </span>
        <span className="hidden md:block">
          <Logo width={140} />
        </span>
      </div>

      <div className="hidden px-4 pb-3 md:block">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Brand</label>
        <select
          value={currentBrandId}
          disabled={pending || brands.length < 2}
          onChange={(e) => startTransition(() => switchBrand(e.target.value))}
          className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm font-medium"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 md:px-3">
        {(approvals ? [...NAV.slice(0, 4), { href: '/approvals', label: 'Approvals', icon: ShieldCheck }, ...NAV.slice(4)] : NAV).map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          const count = href === '/approvals' ? (approvals?.count ?? 0) : href === '/inbox' ? inboxOpen : 0;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <span className="relative">
                <Icon size={18} strokeWidth={2} />
                {count > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-violet md:hidden" />}
              </span>
              <span className="hidden flex-1 md:inline">{label}</span>
              {count > 0 && (
                <span className="tabular hidden rounded-full bg-violet/12 px-2 py-0.5 text-xs font-semibold text-violet md:inline" aria-label={`${count} waiting`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
        {platformAdmin && (
          <Link
            href="/admin"
            title="Platform admin"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <ShieldAlert size={18} strokeWidth={2} />
            <span className="hidden md:inline">Platform admin</span>
          </Link>
        )}
      </nav>

      <div className="border-t border-border p-3 md:p-4">
        <div className="hidden md:block">
          {orgs.length > 1 ? (
            <select
              value={orgId}
              disabled={pending}
              onChange={(e) => startTransition(() => switchOrg(e.target.value))}
              aria-label="Organization"
              className="-ml-1 w-full truncate rounded-md bg-transparent py-0.5 text-sm font-semibold hover:bg-surface-2"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate text-sm font-semibold">{orgName}</p>
          )}
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <form action={signOut} className="md:mt-3">
          <button type="submit" title="Sign out" className="flex items-center gap-2 text-sm text-muted hover:text-text">
            <LogOut size={16} />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
