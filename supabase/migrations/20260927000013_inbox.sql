-- SocialOS: social inbox (comments on the brand's published posts).
-- The server syncs comments for each published post on a schedule (often at first, then less,
-- stopping after 30 days). Team members reply, hide or mark comments done from the app.

create table public.inbox_comments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  brand_id            uuid not null references public.brands(id) on delete cascade,
  social_account_id   uuid not null references public.social_accounts(id) on delete cascade,
  job_id              uuid references public.publish_jobs(id) on delete set null,
  platform            text not null,
  external_id         text not null,
  parent_external_id  text,
  author_name         text not null default '',
  author_external_id  text,
  from_brand          boolean not null default false,
  text                text not null default '',
  commented_at        timestamptz not null,
  permalink           text,
  hidden              boolean not null default false,
  -- Brand-authored comments need no action.
  status              text not null default 'open' check (status in ('open','done')),
  replied_by          uuid references auth.users(id) on delete set null, -- for replies sent from SocialOS
  handled_by          uuid references auth.users(id) on delete set null,
  handled_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (social_account_id, external_id)
);
create index inbox_comments_brand_idx on public.inbox_comments(brand_id, status, commented_at desc);
create index inbox_comments_job_idx on public.inbox_comments(job_id);

alter table public.inbox_comments enable row level security;
create policy inbox_read on public.inbox_comments for select using (public.is_org_member(org_id));
-- Written only by the server (sync, replies, status changes after permission checks).

create trigger inbox_comments_touch before update on public.inbox_comments for each row execute function public.touch_updated_at();

create table public.inbox_sync (
  job_id           uuid primary key references public.publish_jobs(id) on delete cascade,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  next_sync_at     timestamptz,
  last_synced_at   timestamptz,
  note             text
);
create index inbox_sync_due_idx on public.inbox_sync(next_sync_at) where next_sync_at is not null;
alter table public.inbox_sync enable row level security;
create policy inbox_sync_read on public.inbox_sync for select using (public.is_org_member(org_id));

-- Start syncing comments 15 minutes after a post is published (TikTok has no comments API).
create or replace function public.track_published_job_inbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' and new.external_post_id is not null
     and new.platform <> 'tiktok' then
    insert into inbox_sync (job_id, org_id, next_sync_at)
    values (new.id, new.org_id, coalesce(new.published_at, now()) + interval '15 minutes')
    on conflict (job_id) do nothing;
  end if;
  return new;
end $$;
create trigger publish_jobs_track_inbox after update of status on public.publish_jobs
  for each row execute function public.track_published_job_inbox();

-- Posts from the last 30 days published before this migration: sync now.
insert into inbox_sync (job_id, org_id, next_sync_at)
select id, org_id, now() from publish_jobs
 where status = 'published' and external_post_id is not null and platform <> 'tiktok'
   and coalesce(published_at, updated_at) > now() - interval '30 days'
on conflict (job_id) do nothing;

-- Claims posts due for a comment sync (active accounts only), leasing them for 20 minutes.
create or replace function public.claim_due_inbox(p_now timestamptz, p_limit int)
returns table (job_id uuid, org_id uuid, brand_id uuid, social_account_id uuid, platform text, post_type text,
               published_at timestamptz, external_post_id text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select s.job_id from inbox_sync s
      join publish_jobs j on j.id = s.job_id
      join social_accounts a on a.id = j.social_account_id
     where s.next_sync_at <= p_now and a.status = 'active'
     order by s.next_sync_at
     limit p_limit
     for update of s skip locked
  )
  update inbox_sync s set next_sync_at = p_now + interval '20 minutes'
    from due, publish_jobs j, post_variants v
   where s.job_id = due.job_id and j.id = s.job_id and v.id = j.variant_id
  returning s.job_id, j.org_id, j.brand_id, j.social_account_id, j.platform, v.post_type,
            coalesce(j.published_at, j.updated_at), j.external_post_id;
end $$;
revoke all on function public.claim_due_inbox(timestamptz, int) from public, anon, authenticated;
grant execute on function public.claim_due_inbox(timestamptz, int) to service_role;
