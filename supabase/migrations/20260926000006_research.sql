-- Research agent: what to research per brand, and the resulting content opportunities.

alter table public.brand_profiles
  add column research_keywords text[] not null default '{}',
  add column competitors text[] not null default '{}',     -- names or websites
  add column research_weekly boolean not null default false; -- run automatically once a week

create table public.research_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  brand_id       uuid not null references public.brands(id) on delete cascade,
  topic          text not null,
  summary        text not null,
  why_relevant   text not null,
  angle          text not null,                 -- the brand's take / post idea
  platforms      text[] not null default '{}',
  format         text not null default '',
  priority       int not null check (priority between 1 and 10),
  risk           text not null default 'low' check (risk in ('low','medium','high')),
  kind           text not null default 'trend' check (kind in ('trend','news','competitor','question','evergreen')),
  sources        jsonb not null default '[]',   -- [{title, url, published?}]
  status         text not null default 'new' check (status in ('new','saved','used','dismissed')),
  used_post_id   uuid references public.posts(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index research_items_brand_idx on public.research_items(brand_id, status, created_at desc);
create trigger research_items_brand_org before insert or update on public.research_items for each row execute function public.check_brand_org();

alter table public.research_items enable row level security;
create policy research_read on public.research_items for select using (public.is_org_member(org_id));
-- Editors can change status (save / dismiss / mark used); items are created by the server.
create policy research_update on public.research_items for update using (public.can_edit(org_id)) with check (public.can_edit(org_id));
create policy research_delete on public.research_items for delete using (public.can_edit(org_id));

-- Brands due for their weekly research run.
create or replace function public.brands_due_for_research()
returns table (brand_id uuid, org_id uuid) language sql stable security definer set search_path = public as $$
  select p.brand_id, p.org_id
    from brand_profiles p
    join brands b on b.id = p.brand_id and b.status = 'active'
   where p.research_weekly
     and not exists (
       select 1 from agent_runs r
        where r.brand_id = p.brand_id and r.agent = 'research' and r.status = 'succeeded'
          and r.created_at > now() - interval '7 days'
     );
$$;
revoke all on function public.brands_due_for_research() from public, anon, authenticated;
grant execute on function public.brands_due_for_research() to service_role;
