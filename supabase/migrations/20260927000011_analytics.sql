-- SocialOS: post analytics.
-- One row per published post (publish job) with its latest metrics. The server collects them a few
-- times after publishing (1h, 24h, 3d, 7d, 30d); next_collect_at drives the collector.

create table public.post_metrics (
  job_id             uuid primary key references public.publish_jobs(id) on delete cascade,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  brand_id           uuid not null references public.brands(id) on delete cascade,
  post_id            uuid not null references public.posts(id) on delete cascade,
  social_account_id  uuid not null references public.social_accounts(id) on delete cascade,
  platform           text not null,
  post_type          text not null,
  published_at       timestamptz not null,
  -- null = the platform doesn't report it
  views              bigint check (views >= 0),
  reach              bigint check (reach >= 0),
  likes              bigint check (likes >= 0),
  comments           bigint check (comments >= 0),
  shares             bigint check (shares >= 0),
  saves              bigint check (saves >= 0),
  clicks             bigint check (clicks >= 0),
  engagements        bigint generated always as (coalesce(likes,0) + coalesce(comments,0) + coalesce(shares,0) + coalesce(saves,0)) stored,
  collected_at       timestamptz,
  collect_count      int not null default 0,
  next_collect_at    timestamptz,
  note               text,
  updated_at         timestamptz not null default now()
);
create index post_metrics_brand_idx on public.post_metrics(brand_id, published_at desc);
create index post_metrics_due_idx on public.post_metrics(next_collect_at) where next_collect_at is not null;

alter table public.post_metrics enable row level security;
create policy post_metrics_read on public.post_metrics for select using (public.is_org_member(org_id));
-- Written only by the server.

create trigger post_metrics_touch before update on public.post_metrics for each row execute function public.touch_updated_at();

-- Start tracking a post when its job is published.
create or replace function public.track_published_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and new.external_post_id is not null then
    insert into post_metrics (job_id, org_id, brand_id, post_id, social_account_id, platform, post_type, published_at, next_collect_at)
    select new.id, new.org_id, new.brand_id, new.post_id, new.social_account_id, new.platform, v.post_type,
           coalesce(new.published_at, now()), coalesce(new.published_at, now()) + interval '1 hour'
      from post_variants v where v.id = new.variant_id
    on conflict (job_id) do nothing;
  end if;
  return new;
end $$;
create trigger publish_jobs_track_metrics after update of status on public.publish_jobs
  for each row execute function public.track_published_job();

-- Posts published before this migration: collect once now (the collector then schedules the rest).
insert into post_metrics (job_id, org_id, brand_id, post_id, social_account_id, platform, post_type, published_at, next_collect_at)
select j.id, j.org_id, j.brand_id, j.post_id, j.social_account_id, j.platform, v.post_type, coalesce(j.published_at, j.updated_at), now()
  from publish_jobs j join post_variants v on v.id = j.variant_id
 where j.status = 'published' and j.external_post_id is not null
on conflict (job_id) do nothing;

-- Claims posts due for collection (active accounts only). Claimed rows are pushed 30 minutes
-- ahead so concurrent collectors skip them; the collector then sets the real next time.
create or replace function public.claim_due_metrics(p_now timestamptz, p_limit int)
returns table (job_id uuid, org_id uuid, social_account_id uuid, platform text, post_type text,
               published_at timestamptz, external_post_id text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select m.job_id from post_metrics m
      join social_accounts a on a.id = m.social_account_id
     where m.next_collect_at <= p_now and a.status = 'active'
     order by m.next_collect_at
     limit p_limit
     for update of m skip locked
  )
  update post_metrics m set next_collect_at = p_now + interval '30 minutes'
    from due, publish_jobs j
   where m.job_id = due.job_id and j.id = m.job_id
  returning m.job_id, m.org_id, m.social_account_id, m.platform, m.post_type, m.published_at, j.external_post_id;
end $$;
revoke all on function public.claim_due_metrics(timestamptz, int) from public, anon, authenticated;
grant execute on function public.claim_due_metrics(timestamptz, int) to service_role;

-- Stores a collection result. p_metrics: {views, reach, likes, comments, shares, saves, clicks}, nulls allowed.
create or replace function public.record_post_metrics(p_job uuid, p_metrics jsonb, p_collected_at timestamptz, p_next timestamptz, p_note text)
returns void language sql security definer set search_path = public as $$
  -- greatest() ignores nulls, so "not reported" (null) must be kept explicitly.
  update post_metrics set
    views = case when p_metrics->>'views' is null then null else greatest((p_metrics->>'views')::bigint, 0) end,
    reach = case when p_metrics->>'reach' is null then null else greatest((p_metrics->>'reach')::bigint, 0) end,
    likes = case when p_metrics->>'likes' is null then null else greatest((p_metrics->>'likes')::bigint, 0) end,
    comments = case when p_metrics->>'comments' is null then null else greatest((p_metrics->>'comments')::bigint, 0) end,
    shares = case when p_metrics->>'shares' is null then null else greatest((p_metrics->>'shares')::bigint, 0) end,
    saves = case when p_metrics->>'saves' is null then null else greatest((p_metrics->>'saves')::bigint, 0) end,
    clicks = case when p_metrics->>'clicks' is null then null else greatest((p_metrics->>'clicks')::bigint, 0) end,
    collected_at = p_collected_at,
    collect_count = collect_count + 1,
    next_collect_at = p_next,
    note = p_note
  where job_id = p_job;
$$;
revoke all on function public.record_post_metrics(uuid, jsonb, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_post_metrics(uuid, jsonb, timestamptz, timestamptz, text) to service_role;
