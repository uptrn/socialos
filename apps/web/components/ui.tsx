import clsx from 'clsx';
import Image from 'next/image';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

// Full logo is 1139×312; mark is square.
export function Logo({ width = 140, className }: { width?: number; className?: string }) {
  const height = Math.round((width * 312) / 1139);
  return (
    <span className={clsx('inline-block', className)} style={{ width, height }}>
      <Image src="/brand/socialos-logo.png" alt="SocialOS" width={width} height={height} priority className="dark:hidden" />
      <Image src="/brand/socialos-logo-dark.png" alt="SocialOS" width={width} height={height} priority className="hidden dark:block" />
    </span>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return <Image src="/brand/socialos-mark-512.png" alt="SocialOS" width={size} height={size} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function buttonClass(variant: ButtonVariant = 'primary', size: 'sm' | 'md' = 'md') {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
    variant === 'primary' && 'bg-brand text-white hover:bg-brand-hover',
    variant === 'secondary' && 'border border-border bg-surface text-text hover:bg-surface-2',
    variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-text',
    variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger/10',
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return <button className={clsx(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-[var(--radius-card)] border border-border bg-surface shadow-card', className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-brand focus:outline-none';

export function Field({ label, hint, children, error }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-surface-2 text-muted' },
  ready: { label: 'Ready', className: 'bg-surface-2 text-text' },
  pending_approval: { label: 'Awaiting approval', className: 'bg-violet/12 text-violet' },
  scheduled: { label: 'Scheduled', className: 'bg-brand/12 text-brand' },
  publishing: { label: 'Publishing', className: 'bg-cyan/15 text-cyan' },
  processing: { label: 'Processing', className: 'bg-cyan/15 text-cyan' },
  retrying: { label: 'Retrying', className: 'bg-cyan/15 text-cyan' },
  published: { label: 'Published', className: 'bg-success/15 text-success' },
  partially_published: { label: 'Partly published', className: 'bg-warning/15 text-warning' },
  needs_check: { label: 'Needs check', className: 'bg-warning/15 text-warning' },
  missed: { label: 'Missed', className: 'bg-warning/15 text-warning' },
  paused: { label: 'Paused', className: 'bg-warning/15 text-warning' },
  failed: { label: 'Failed', className: 'bg-danger/15 text-danger' },
  needs_revision: { label: 'Needs revision', className: 'bg-danger/15 text-danger' },
  cancelled: { label: 'Cancelled', className: 'bg-surface-2 text-muted line-through' },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status, className: 'bg-surface-2 text-muted' };
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', style.className)}>{style.label}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="bg-brand-gradient mb-4 h-1.5 w-16 rounded-full" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
