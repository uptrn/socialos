import { PAID_PLANS, PLANS, TRIAL_DAYS } from '@socialos/core';
import { BarChart3, CalendarClock, Check, MessagesSquare, PenLine, ShieldCheck, Telescope, Wand2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PLATFORM_META, PlatformIcon } from '@/components/platform';
import { PublicShell } from '@/components/public-shell';
import { buttonClass, Card } from '@/components/ui';
import { FEATURE_LABELS } from '@/lib/billing/access';
import { isCompanyMode } from '@/lib/mode';
import { createUserClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'SocialOS: plan, create, publish and learn on social media',
  description: 'AI agents for social media teams: research, writing, graphics, scheduling to every network, approvals, inbox and analytics.',
};

const MODULES = [
  { icon: Telescope, title: 'Research agent', body: 'Finds what your audience is talking about this week, with sources, and turns it into post ideas.' },
  { icon: PenLine, title: 'Content agent', body: 'Drafts posts in your brand voice for each network, and checks them against your rules before they go out.' },
  { icon: Wand2, title: 'Creative studio', body: 'On-brand graphics and carousels, AI images and free stock photos, ready at the right size.' },
  { icon: CalendarClock, title: 'Scheduling', body: 'Every post type on Facebook, Instagram, Threads, LinkedIn, X, YouTube and TikTok, published on time.' },
  { icon: ShieldCheck, title: 'Approvals', body: 'Posts from your team wait for a reviewer when you want a second pair of eyes.' },
  { icon: MessagesSquare, title: 'Inbox', body: 'Comments from every network in one place, with suggested replies in your voice.' },
  { icon: BarChart3, title: 'Analytics', body: 'What worked and why, with AI insights on what to post next.' },
];

export default async function Home() {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect('/calendar');
  // Company mode: an internal tool, so no public marketing or pricing page.
  if (isCompanyMode()) redirect('/login');

  return (
    <PublicShell>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-brand">Social media, run by AI agents and your team</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Plan, create, publish and learn, for every brand you manage.</h1>
          <p className="mt-5 text-lg text-muted">
            SocialOS researches topics, writes and designs posts in your brand voice, publishes them to every network on schedule, and tells you what worked. You stay in control of
            everything that goes out.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login?mode=signup" className={buttonClass()}>
              Start your {TRIAL_DAYS}-day free trial
            </Link>
            <Link href="#pricing" className={buttonClass('secondary')}>
              See pricing
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted">No card needed for the trial.</p>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {(Object.keys(PLATFORM_META) as (keyof typeof PLATFORM_META)[]).map((p) => (
              <PlatformIcon key={p} platform={p} size={28} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="text-brand" size={22} />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight">Pricing</h2>
        <p className="mt-1 text-muted">Monthly prices, excluding tax. Yearly billing gets two months free. Team members are included.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PAID_PLANS.map((id) => {
            const p = PLANS[id];
            return (
              <Card key={id} className="flex flex-col p-6">
                <p className="font-semibold">{p.label}</p>
                <p className="mt-2">
                  <span className="text-4xl font-bold">${p.monthlyUsd}</span>
                  <span className="text-muted">/month</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {[
                    `${p.brands} brand${p.brands > 1 ? 's' : ''}`,
                    `${p.socialAccounts} social accounts`,
                    `$${p.aiBudgetUsd} of AI each month`,
                    'Inbox, analytics and approvals',
                    ...p.features.filter((f) => f !== 'publishing').map((f) => FEATURE_LABELS[f]),
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-success" />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link href="/login?mode=signup" className={`${buttonClass(id === 'growth' ? 'primary' : 'secondary')} mt-6 justify-center`}>
                  Start free trial
                </Link>
              </Card>
            );
          })}
        </div>
      </section>
    </PublicShell>
  );
}
