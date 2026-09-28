-- SaaS billing: one subscription row per organization, synced from Stripe by the webhook.

alter table public.organizations
  add column billing_exempt boolean not null default false; -- our own portfolio / custom enterprise deals

create table public.subscriptions (
  org_id                  uuid primary key references public.organizations(id) on delete cascade,
  plan                    text not null default 'trial', -- trial | starter | growth | agency
  status                  text not null default 'trialing', -- Stripe status, or 'trialing' for the no-card trial
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  past_due_since          timestamptz,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  updated_at              timestamptz not null default now()
);
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions for select using (public.is_org_member(org_id));

-- Stripe webhook events already processed (Stripe can deliver an event more than once).
create table public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);
alter table public.stripe_events enable row level security; -- server only

-- Existing organizations start a trial now.
insert into public.subscriptions (org_id, plan, status, trial_ends_at)
select id, 'trial', 'trialing', now() + interval '14 days' from public.organizations
on conflict (org_id) do nothing;

-- New organizations: same as before, plus a 14-day no-card trial.
create or replace function public.create_organization(p_name text, p_slug text, p_brand_name text, p_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into organizations (name, slug) values (p_name, p_slug) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into brands (org_id, name, slug, timezone)
  values (v_org, p_brand_name, regexp_replace(lower(p_brand_name), '[^a-z0-9]+', '-', 'g'), p_timezone);
  insert into subscriptions (org_id, plan, status, trial_ends_at) values (v_org, 'trial', 'trialing', now() + interval '14 days');
  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_org, 'user', auth.uid(), 'organization.created', 'organization', v_org);
  return v_org;
end $$;

-- Usage counts shown on the billing page and checked against plan limits.
create or replace function public.org_usage_counts(p_org uuid)
returns table (brands int, social_accounts int) language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from brands where org_id = p_org and status = 'active'),
    (select count(*)::int from social_accounts where org_id = p_org and status <> 'revoked');
$$;
revoke all on function public.org_usage_counts(uuid) from public, anon, authenticated;
grant execute on function public.org_usage_counts(uuid) to service_role;
