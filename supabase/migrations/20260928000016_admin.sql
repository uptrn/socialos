-- SocialOS: platform admin console support + protection of server-managed organization fields.
--
-- Security fix: the org_update policy (migration 1) lets owners/admins update their organization row,
-- which also allowed them to set billing_exempt (free internal plan). Server-managed columns can now
-- only be changed by the service role (the app server / SocialOS staff), never by users directly.

alter table public.organizations
  add column suspended_at timestamptz,
  add column suspended_reason text check (length(suspended_reason) <= 500);

create or replace function public.protect_org_fields()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and (new.billing_exempt is distinct from old.billing_exempt
          or new.suspended_at is distinct from old.suspended_at
          or new.suspended_reason is distinct from old.suspended_reason
          or new.slug is distinct from old.slug) then
    raise exception 'This field can only be changed by SocialOS' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organizations_protect_fields before update on public.organizations
  for each row execute function public.protect_org_fields();

-- Platform-wide numbers for the admin console (service role only).
create or replace function public.platform_overview()
returns table (
  organizations int, users int, active_paid int, trialing int, locked_or_canceled int, exempt int, suspended int,
  posts_published_24h int, jobs_failed_24h int, ai_spend_month numeric
) language sql stable security definer set search_path = public, auth as $$
  select
    (select count(*)::int from organizations),
    (select count(*)::int from auth.users),
    (select count(*)::int from subscriptions where status = 'active' and plan in ('starter','growth','agency')),
    (select count(*)::int from subscriptions where status = 'trialing'),
    (select count(*)::int from subscriptions where status in ('canceled','unpaid','incomplete_expired','past_due')),
    (select count(*)::int from organizations where billing_exempt),
    (select count(*)::int from organizations where suspended_at is not null),
    (select count(*)::int from publish_jobs where status = 'published' and published_at > now() - interval '24 hours'),
    (select count(*)::int from publish_jobs where status in ('failed','needs_check','needs_revision') and updated_at > now() - interval '24 hours'),
    (select coalesce(sum(cost_usd), 0) from agent_runs where created_at >= date_trunc('month', now()));
$$;

-- One row per organization with the numbers support needs.
create or replace function public.platform_org_list()
returns table (
  id uuid, name text, slug text, created_at timestamptz, billing_exempt boolean, suspended_at timestamptz,
  plan text, status text, trial_ends_at timestamptz, owner_email text, members int, brands int, accounts int,
  posts_30d int, ai_spend_month numeric
) language sql stable security definer set search_path = public, auth as $$
  select o.id, o.name, o.slug, o.created_at, o.billing_exempt, o.suspended_at,
         s.plan, s.status, s.trial_ends_at,
         (select u.email::text from org_members m join auth.users u on u.id = m.user_id
           where m.org_id = o.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
         (select count(*)::int from org_members m where m.org_id = o.id and m.status = 'active'),
         (select count(*)::int from brands b where b.org_id = o.id and b.status = 'active'),
         (select count(*)::int from social_accounts a where a.org_id = o.id and a.status <> 'revoked'),
         (select count(*)::int from publish_jobs j where j.org_id = o.id and j.status = 'published' and j.published_at > now() - interval '30 days'),
         (select coalesce(sum(cost_usd), 0) from agent_runs r where r.org_id = o.id and r.created_at >= date_trunc('month', now()))
    from organizations o
    left join subscriptions s on s.org_id = o.id
   order by o.created_at desc;
$$;

do $$
declare f text;
begin
  foreach f in array array['platform_overview()', 'platform_org_list()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
