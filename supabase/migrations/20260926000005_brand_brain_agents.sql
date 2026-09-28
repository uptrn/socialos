-- Brand Brain (the facts and voice every AI agent writes from) and the AI run log.

create table public.brand_profiles (
  brand_id          uuid primary key references public.brands(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  website           text,
  description       text not null default '',   -- what the product is, in plain words
  audience          text not null default '',   -- who it's for, their problems
  products          text not null default '',   -- features, plans, integrations (facts only)
  voice             text not null default '',   -- tone and style
  words_to_use      text[] not null default '{}',
  words_to_avoid    text[] not null default '{}',
  approved_claims   text[] not null default '{}', -- statements agents may make as fact
  banned_claims     text[] not null default '{}', -- statements agents must never make
  default_hashtags  text[] not null default '{}',
  primary_cta       text not null default '',
  example_posts     text not null default '',   -- posts that sound right, separated by blank lines
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);
create trigger brand_profiles_touch before update on public.brand_profiles for each row execute function public.touch_updated_at();
create trigger brand_profiles_brand_org before insert or update on public.brand_profiles for each row execute function public.check_brand_org();

alter table public.brand_profiles enable row level security;
create policy brand_profiles_read on public.brand_profiles for select using (public.is_org_member(org_id));
create policy brand_profiles_write on public.brand_profiles for all using (public.can_edit(org_id)) with check (public.can_edit(org_id));

-- Every AI call: who, which agent, which model, what it cost. Written by the server only.
create table public.agent_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  brand_id          uuid references public.brands(id) on delete cascade,
  agent             text not null,                -- e.g. 'content', 'qa'
  model             text not null,                -- model that actually served the request
  status            text not null check (status in ('succeeded','failed','refused','over_budget')),
  input             jsonb not null default '{}',
  output            jsonb,
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  duration_ms       int,
  error             text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);
create index agent_runs_org_month_idx on public.agent_runs(org_id, created_at desc);

alter table public.agent_runs enable row level security;
create policy agent_runs_read on public.agent_runs for select using (public.is_org_member(org_id));

-- This month's AI spend for an organization (for budget enforcement).
create or replace function public.org_ai_spend_this_month(p_org uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from agent_runs
   where org_id = p_org and created_at >= date_trunc('month', now());
$$;
revoke all on function public.org_ai_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.org_ai_spend_this_month(uuid) to service_role;
