-- SocialOS: tracked links, clicks and conversions.
-- At publish time each outbound URL in a post becomes {APP_URL}/l/{code}. The redirect records the click
-- and forwards to the destination with UTMs and a click id (sos_cid). The customer's website reports
-- conversions (signup, purchase…) with that click id, through a JS snippet or a server call.

alter table public.brands
  add column link_tracking boolean not null default true,
  -- Public key used by the website snippet (safe to expose); the server key is stored hashed.
  add column tracking_key text not null default replace(gen_random_uuid()::text, '-', ''),
  add column tracking_secret_hash text;
create unique index brands_tracking_key_idx on public.brands(tracking_key);

create table public.tracked_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  brand_id     uuid not null references public.brands(id) on delete cascade,
  job_id       uuid references public.publish_jobs(id) on delete set null,
  post_id      uuid references public.posts(id) on delete set null,
  platform     text not null,
  code         text not null unique check (code ~ '^[0-9A-Za-z]{5,12}$'),
  destination  text not null check (destination ~ '^https?://'),   -- as written in the post
  target_url   text not null check (target_url ~ '^https?://'),    -- with UTMs
  clicks       int not null default 0,
  created_at   timestamptz not null default now(),
  unique (job_id, destination)
);
create index tracked_links_brand_idx on public.tracked_links(brand_id, created_at desc);

create table public.link_clicks (
  id            uuid primary key default gen_random_uuid(), -- also the click id passed to the website
  link_id       uuid not null references public.tracked_links(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  clicked_at    timestamptz not null default now(),
  -- Hash of IP + browser with a daily-rotating salt: counts unique visitors without storing IPs.
  visitor_hash  text not null,
  country       text,
  referrer_host text
);
create index link_clicks_link_idx on public.link_clicks(link_id, clicked_at);
create index link_clicks_brand_idx on public.link_clicks(brand_id, clicked_at);

create table public.conversions (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  brand_id     uuid not null references public.brands(id) on delete cascade,
  click_id     uuid references public.link_clicks(id) on delete set null,
  link_id      uuid references public.tracked_links(id) on delete set null,
  event        text not null check (event ~ '^[a-z][a-z0-9_]{1,39}$'),
  value        numeric(14,2) check (value >= 0),
  currency     text check (currency ~ '^[A-Z]{3}$'),
  external_id  text check (length(external_id) <= 200), -- the site's own id, to ignore repeats
  source       text not null check (source in ('snippet','server')),
  occurred_at  timestamptz not null default now()
);
create index conversions_brand_idx on public.conversions(brand_id, occurred_at desc);
create index conversions_link_idx on public.conversions(link_id);
create unique index conversions_dedupe_idx on public.conversions(brand_id, event, external_id) where external_id is not null;

alter table public.tracked_links enable row level security;
alter table public.link_clicks enable row level security;
alter table public.conversions enable row level security;
create policy tracked_links_read on public.tracked_links for select using (public.is_org_member(org_id));
create policy link_clicks_read on public.link_clicks for select using (public.is_org_member(org_id));
create policy conversions_read on public.conversions for select using (public.is_org_member(org_id));
-- All writes go through the server.

-- Records a click (unless it's a bot) and returns where to send the visitor. Unknown code -> no row.
create or replace function public.record_link_click(p_code text, p_visitor_hash text, p_country text, p_referrer_host text, p_bot boolean)
returns table (target_url text, click_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_link tracked_links%rowtype;
  v_click uuid;
begin
  select * into v_link from tracked_links where code = p_code;
  if not found then return; end if;
  if not p_bot then
    insert into link_clicks (link_id, org_id, brand_id, visitor_hash, country, referrer_host)
    values (v_link.id, v_link.org_id, v_link.brand_id, p_visitor_hash, left(p_country, 2), left(p_referrer_host, 200))
    returning id into v_click;
    update tracked_links set clicks = clicks + 1 where id = v_link.id;
  end if;
  return query select v_link.target_url, v_click;
end $$;

-- Records a conversion for a brand. The click must belong to the brand and be under 90 days old;
-- at most 50 events per click. Returns false when ignored (duplicate, unknown click, limit).
create or replace function public.record_conversion(p_brand uuid, p_click uuid, p_event text, p_value numeric, p_currency text, p_external_id text, p_source text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_click link_clicks%rowtype;
  v_org uuid;
begin
  select org_id into v_org from brands where id = p_brand;
  if v_org is null then return false; end if;
  if p_click is not null then
    select * into v_click from link_clicks where id = p_click and brand_id = p_brand and clicked_at > now() - interval '90 days';
    if not found then return false; end if;
    if (select count(*) from conversions where click_id = p_click) >= 50 then return false; end if;
  end if;
  insert into conversions (org_id, brand_id, click_id, link_id, event, value, currency, external_id, source)
  values (v_org, p_brand, p_click, v_click.link_id, p_event, p_value, p_currency, nullif(p_external_id, ''), p_source)
  on conflict (brand_id, event, external_id) where external_id is not null do nothing;
  return found;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'record_link_click(text, text, text, text, boolean)',
    'record_conversion(uuid, uuid, text, numeric, text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
