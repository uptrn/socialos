-- SocialOS: tenancy + scheduling & publishing foundation.
-- Reads are protected by RLS. Scheduling, job state and tokens are written only by
-- the server (service role) after it has checked permissions and validated content.

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at  timestamptz not null default now()
);

create table public.org_members (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','manager','reviewer','viewer')),
  status      text not null default 'active' check (status in ('invited','active','removed')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members(user_id);

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(name) between 1 and 120),
  slug        text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  timezone    text not null default 'UTC',
  status      text not null default 'active' check (status in ('active','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, slug)
);
create index brands_org_idx on public.brands(org_id);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and status = 'active' and role = any(p_roles)
  );
$$;

-- Roles that may create and edit content.
create or replace function public.can_edit(p_org uuid)
returns boolean language sql stable as $$
  select public.has_org_role(p_org, array['owner','admin','manager']);
$$;

-- Keep brand_id consistent with org_id on every brand-owned row.
create or replace function public.check_brand_org()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.brands where id = new.brand_id and org_id = new.org_id) then
    raise exception 'brand % does not belong to org %', new.brand_id, new.org_id;
  end if;
  return new;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Social accounts
-- ---------------------------------------------------------------------------

create table public.social_accounts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  brand_id              uuid not null references public.brands(id) on delete cascade,
  platform              text not null check (platform in ('facebook','instagram','threads','linkedin','x','tiktok','youtube')),
  external_account_id   text not null,
  display_name          text not null,
  avatar_url            text,
  status                text not null default 'active' check (status in ('active','expired','revoked','error')),
  status_reason         text,
  -- Reference to the encrypted token in Supabase Vault; the token itself never lives here.
  token_ref             uuid,
  token_expires_at      timestamptz,
  scopes                text[] not null default '{}',
  connected_by          uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (brand_id, platform, external_account_id)
);
create index social_accounts_brand_idx on public.social_accounts(brand_id);

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------

create table public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  brand_id        uuid not null references public.brands(id) on delete cascade,
  kind            text not null check (kind in ('image','video','document')),
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  width           int,
  height          int,
  duration_sec    numeric(10,3),
  page_count      int,
  storage_path    text not null unique, -- {org_id}/{brand_id}/{id}.{ext} in the "media" bucket
  original_name   text,
  status          text not null default 'ready' check (status in ('uploading','ready','failed','deleted')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index media_assets_brand_idx on public.media_assets(brand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Posts: one post, one variant per connected account/platform
-- ---------------------------------------------------------------------------

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  title         text, -- internal name shown in calendar
  status        text not null default 'draft'
                check (status in ('draft','scheduled','publishing','partially_published','published','failed','cancelled')),
  scheduled_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_brand_schedule_idx on public.posts(brand_id, scheduled_at);

create table public.post_variants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  brand_id           uuid not null references public.brands(id) on delete cascade,
  post_id            uuid not null references public.posts(id) on delete cascade,
  social_account_id  uuid not null references public.social_accounts(id) on delete restrict,
  platform           text not null,
  post_type          text not null check (post_type in ('text','image','carousel','video','reel','story','short','document')),
  caption            text not null default '',
  thread_parts       text[] not null default '{}',
  options            jsonb not null default '{}',
  -- Bumped on every edit after scheduling, so a changed post gets a new idempotency key.
  revision           int not null default 1,
  validation         jsonb not null default '[]', -- last validation issues from the app
  status             text not null default 'draft'
                     check (status in ('draft','ready','scheduled','publishing','published','failed','cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (post_id, social_account_id)
);
create index post_variants_post_idx on public.post_variants(post_id);

create table public.variant_media (
  variant_id  uuid not null references public.post_variants(id) on delete cascade,
  media_id    uuid not null references public.media_assets(id) on delete restrict,
  position    int not null check (position >= 0),
  alt_text    text,
  primary key (variant_id, position)
);

-- ---------------------------------------------------------------------------
-- Publish jobs (server-written only)
-- ---------------------------------------------------------------------------

create table public.publish_jobs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  brand_id            uuid not null references public.brands(id) on delete cascade,
  post_id             uuid not null references public.posts(id) on delete cascade,
  variant_id          uuid not null references public.post_variants(id) on delete cascade,
  social_account_id   uuid not null references public.social_accounts(id) on delete restrict,
  platform            text not null,
  scheduled_at        timestamptz not null,
  status              text not null default 'scheduled'
                      check (status in ('scheduled','publishing','processing','retrying','published','failed',
                                        'needs_revision','needs_check','missed','paused','cancelled')),
  attempt_count       int not null default 0,
  next_attempt_at     timestamptz,
  locked_at           timestamptz,
  resume_state        jsonb,
  idempotency_key     text not null unique,
  last_error_class    text,
  last_error_message  text,
  external_post_id    text,
  published_url       text,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index publish_jobs_due_idx on public.publish_jobs(status, scheduled_at)
  where status in ('scheduled','retrying','processing');
create index publish_jobs_post_idx on public.publish_jobs(post_id);
-- A published job must record where it went.
alter table public.publish_jobs add constraint published_has_external_id
  check (status <> 'published' or external_post_id is not null);

-- ---------------------------------------------------------------------------
-- History and audit
-- ---------------------------------------------------------------------------

create table public.status_transitions (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  brand_id     uuid references public.brands(id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  from_status  text,
  to_status    text not null,
  actor_type   text not null check (actor_type in ('user','system','worker')),
  actor_id     uuid,
  reason       text,
  created_at   timestamptz not null default now()
);
create index status_transitions_entity_idx on public.status_transitions(entity_type, entity_id, created_at);

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  brand_id       uuid references public.brands(id) on delete cascade,
  actor_type     text not null check (actor_type in ('user','system','worker','platform_admin')),
  actor_id       uuid,
  action         text not null,
  resource_type  text not null,
  resource_id    uuid,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(org_id, created_at desc);

-- Record every publish job status change automatically.
create or replace function public.log_job_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into status_transitions (org_id, brand_id, entity_type, entity_id, from_status, to_status, actor_type, reason)
    values (new.org_id, new.brand_id, 'publish_job', new.id,
            case when tg_op = 'INSERT' then null else old.status end,
            new.status, 'worker', new.last_error_message);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger brands_touch before update on public.brands for each row execute function public.touch_updated_at();
create trigger social_accounts_touch before update on public.social_accounts for each row execute function public.touch_updated_at();
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();
create trigger post_variants_touch before update on public.post_variants for each row execute function public.touch_updated_at();
create trigger publish_jobs_touch before update on public.publish_jobs for each row execute function public.touch_updated_at();

create trigger social_accounts_brand_org before insert or update on public.social_accounts for each row execute function public.check_brand_org();
create trigger media_assets_brand_org before insert or update on public.media_assets for each row execute function public.check_brand_org();
create trigger posts_brand_org before insert or update on public.posts for each row execute function public.check_brand_org();
create trigger post_variants_brand_org before insert or update on public.post_variants for each row execute function public.check_brand_org();
create trigger publish_jobs_brand_org before insert or update on public.publish_jobs for each row execute function public.check_brand_org();

create trigger publish_jobs_transition after insert or update on public.publish_jobs for each row execute function public.log_job_transition();

-- A variant's account must belong to the variant's brand.
create or replace function public.check_variant_account()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.social_accounts
    where id = new.social_account_id and brand_id = new.brand_id and platform = new.platform
  ) then
    raise exception 'social account % is not a % account of brand %', new.social_account_id, new.platform, new.brand_id;
  end if;
  return new;
end $$;
create trigger post_variants_account before insert or update on public.post_variants for each row execute function public.check_variant_account();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations       enable row level security;
alter table public.org_members         enable row level security;
alter table public.brands              enable row level security;
alter table public.social_accounts     enable row level security;
alter table public.media_assets        enable row level security;
alter table public.posts               enable row level security;
alter table public.post_variants       enable row level security;
alter table public.variant_media       enable row level security;
alter table public.publish_jobs        enable row level security;
alter table public.status_transitions  enable row level security;
alter table public.audit_logs          enable row level security;

create policy org_read on public.organizations for select using (public.is_org_member(id));
create policy org_update on public.organizations for update using (public.has_org_role(id, array['owner','admin']));

create policy members_read on public.org_members for select using (public.is_org_member(org_id));
create policy members_manage on public.org_members for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

create policy brands_read on public.brands for select using (public.is_org_member(org_id));
create policy brands_write on public.brands for all
  using (public.has_org_role(org_id, array['owner','admin']))
  with check (public.has_org_role(org_id, array['owner','admin']));

-- Accounts are connected through the OAuth callback (server); members can view and admins disconnect.
create policy accounts_read on public.social_accounts for select using (public.is_org_member(org_id));
create policy accounts_delete on public.social_accounts for delete using (public.has_org_role(org_id, array['owner','admin']));

create policy media_read on public.media_assets for select using (public.is_org_member(org_id));
create policy media_write on public.media_assets for all using (public.can_edit(org_id)) with check (public.can_edit(org_id));

-- Drafts are edited by users; a scheduled post is changed only through the server.
create policy posts_read on public.posts for select using (public.is_org_member(org_id));
create policy posts_insert on public.posts for insert with check (public.can_edit(org_id) and status = 'draft');
create policy posts_update on public.posts for update
  using (public.can_edit(org_id) and status = 'draft') with check (public.can_edit(org_id) and status = 'draft');
create policy posts_delete on public.posts for delete using (public.can_edit(org_id) and status in ('draft','cancelled'));

create policy variants_read on public.post_variants for select using (public.is_org_member(org_id));
create policy variants_write on public.post_variants for all
  using (public.can_edit(org_id) and status in ('draft','ready'))
  with check (public.can_edit(org_id) and status in ('draft','ready'));

create policy variant_media_read on public.variant_media for select
  using (exists (select 1 from public.post_variants v where v.id = variant_id and public.is_org_member(v.org_id)));
create policy variant_media_write on public.variant_media for all
  using (exists (select 1 from public.post_variants v where v.id = variant_id and public.can_edit(v.org_id) and v.status in ('draft','ready')))
  with check (exists (select 1 from public.post_variants v where v.id = variant_id and public.can_edit(v.org_id) and v.status in ('draft','ready')));

-- Read-only for users; only the service role writes jobs, transitions and audit logs.
create policy jobs_read on public.publish_jobs for select using (public.is_org_member(org_id));
create policy transitions_read on public.status_transitions for select using (public.is_org_member(org_id));
create policy audit_read on public.audit_logs for select using (public.has_org_role(org_id, array['owner','admin']));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- New user creates their organization; they become its owner, with a first brand.
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
  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_org, 'user', auth.uid(), 'organization.created', 'organization', v_org);
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;

-- Worker: atomically claim jobs that are due. Safe with several workers (SKIP LOCKED).
-- Jobs stuck in "publishing" (worker crashed mid-call) are moved to needs_check,
-- because the post may already be live.
create or replace function public.claim_due_publish_jobs(p_now timestamptz, p_limit int default 20)
returns setof public.publish_jobs language plpgsql security definer set search_path = public as $$
begin
  update publish_jobs
     set status = 'needs_check',
         last_error_class = 'ambiguous',
         last_error_message = 'Worker stopped while publishing; check the platform before retrying.',
         locked_at = null
   where status = 'publishing' and locked_at < p_now - interval '10 minutes';

  return query
  update publish_jobs j
     set status = 'publishing',
         attempt_count = j.attempt_count + 1,
         locked_at = p_now
   where j.id in (
     select id from publish_jobs
      where (status = 'scheduled' and scheduled_at <= p_now)
         or (status in ('retrying','processing') and next_attempt_at <= p_now)
      order by coalesce(next_attempt_at, scheduled_at)
      limit p_limit
      for update skip locked
   )
  returning j.*;
end $$;
revoke all on function public.claim_due_publish_jobs(timestamptz, int) from public, anon, authenticated;
grant execute on function public.claim_due_publish_jobs(timestamptz, int) to service_role;

-- Keep a post's overall status in line with its jobs.
create or replace function public.refresh_post_status(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_published int; v_active int; v_problem int;
begin
  select count(*),
         count(*) filter (where status = 'published'),
         count(*) filter (where status in ('scheduled','publishing','processing','retrying')),
         count(*) filter (where status in ('failed','needs_revision','needs_check','missed','paused'))
    into v_total, v_published, v_active, v_problem
    from publish_jobs where post_id = p_post and status <> 'cancelled';

  update posts set status = case
      when v_total = 0 then status
      when v_published = v_total then 'published'
      when v_active > 0 and v_published = 0 and v_problem = 0 then 'scheduled'
      when v_published > 0 then 'partially_published'
      when v_active > 0 then 'publishing'
      else 'failed'
    end
  where id = p_post;
end $$;
revoke all on function public.refresh_post_status(uuid) from public, anon, authenticated;
grant execute on function public.refresh_post_status(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private "media" bucket, paths {org_id}/{brand_id}/{file}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 5368709120) -- 5 GB
on conflict (id) do nothing;

create policy media_objects_read on storage.objects for select
  using (bucket_id = 'media' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy media_objects_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.can_edit(((storage.foldername(name))[1])::uuid));
create policy media_objects_delete on storage.objects for delete
  using (bucket_id = 'media' and public.can_edit(((storage.foldername(name))[1])::uuid));
