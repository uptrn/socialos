-- SocialOS: approval workflow.
-- A brand can require approval. Then posts from managers go to "pending_approval" instead of being
-- scheduled; an owner, admin or reviewer approves (which schedules it) or rejects it with a note
-- (back to draft). Owners and admins schedule directly. Content can't change while a post waits,
-- so the reviewer approves exactly what they saw.

alter table public.brands add column require_approval boolean not null default false;

alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft','pending_approval','scheduled','publishing','partially_published','published','failed','cancelled'));
alter table public.posts
  add column approval_requested_at timestamptz, -- when the submitter asked for it to go out (null = as soon as approved)
  add column submitted_by uuid references auth.users(id) on delete set null,
  add column submitted_at timestamptz,
  add column review_note text,                  -- latest rejection note, shown to the author
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz;
create index posts_pending_idx on public.posts(brand_id, submitted_at) where status = 'pending_approval';

-- Variants and their media are editable only while the post itself is a draft.
drop policy variants_write on public.post_variants;
create policy variants_write on public.post_variants for all
  using (public.can_edit(org_id) and status in ('draft','ready')
         and exists (select 1 from public.posts p where p.id = post_id and p.status = 'draft'))
  with check (public.can_edit(org_id) and status in ('draft','ready')
         and exists (select 1 from public.posts p where p.id = post_id and p.status = 'draft'));
drop policy variant_media_write on public.variant_media;
create policy variant_media_write on public.variant_media for all
  using (exists (select 1 from public.post_variants v join public.posts p on p.id = v.post_id
                  where v.id = variant_id and public.can_edit(v.org_id) and v.status in ('draft','ready') and p.status = 'draft'))
  with check (exists (select 1 from public.post_variants v join public.posts p on p.id = v.post_id
                  where v.id = variant_id and public.can_edit(v.org_id) and v.status in ('draft','ready') and p.status = 'draft'));

-- History of submissions and decisions (shown on the post).
create table public.post_reviews (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  brand_id    uuid not null references public.brands(id) on delete cascade,
  post_id     uuid not null references public.posts(id) on delete cascade,
  action      text not null check (action in ('submitted','approved','rejected','withdrawn')),
  actor_id    uuid references auth.users(id) on delete set null,
  note        text check (length(note) <= 2000),
  created_at  timestamptz not null default now()
);
create index post_reviews_post_idx on public.post_reviews(post_id, created_at);
alter table public.post_reviews enable row level security;
create policy post_reviews_read on public.post_reviews for select using (public.is_org_member(org_id));

create or replace function public.is_approver(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(member_role(p_org, p_user) in ('owner','admin','reviewer'), false);
$$;

-- Manager (or anyone who can edit) asks for approval. p_at = requested publish time, null = as soon as approved.
create or replace function public.submit_post_for_approval(p_post uuid, p_at timestamptz, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_post posts%rowtype;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;
  if coalesce(member_role(v_post.org_id, p_actor), '') not in ('owner','admin','manager') then
    raise exception 'You cannot submit posts in this workspace' using errcode = '42501';
  end if;
  if v_post.status <> 'draft' then raise exception 'only drafts can be submitted (post is %)', v_post.status; end if;
  if not exists (select 1 from post_variants where post_id = p_post) then raise exception 'post has no platforms selected'; end if;

  update posts set status = 'pending_approval', approval_requested_at = p_at, scheduled_at = p_at,
                   submitted_by = p_actor, submitted_at = now(), review_note = null
   where id = p_post;
  insert into post_reviews (org_id, brand_id, post_id, action, actor_id) values (v_post.org_id, v_post.brand_id, p_post, 'submitted', p_actor);
  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (v_post.org_id, v_post.brand_id, 'user', p_actor, 'post.submitted', 'post', p_post, jsonb_build_object('requested_at', p_at));
end $$;

-- Approver approves: the post is scheduled for the requested time, or now if that has passed.
-- Returns the time it was scheduled for.
create or replace function public.approve_post(p_post uuid, p_actor uuid, p_note text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_post posts%rowtype;
  v_at timestamptz;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;
  if not is_approver(v_post.org_id, p_actor) then
    raise exception 'Only owners, admins and reviewers can approve posts' using errcode = '42501';
  end if;
  if v_post.status <> 'pending_approval' then raise exception 'This post is not waiting for approval' using errcode = 'P0002'; end if;

  v_at := greatest(coalesce(v_post.approval_requested_at, now()), now());
  update posts set status = 'draft', reviewed_by = p_actor, reviewed_at = now(), review_note = null where id = p_post;
  perform schedule_post(p_post, v_at, p_actor);

  insert into post_reviews (org_id, brand_id, post_id, action, actor_id, note)
  values (v_post.org_id, v_post.brand_id, p_post, 'approved', p_actor, nullif(trim(p_note), ''));
  return v_at;
end $$;

-- Approver rejects with a note: back to draft for the author to fix.
create or replace function public.reject_post(p_post uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_post posts%rowtype;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;
  if not is_approver(v_post.org_id, p_actor) then
    raise exception 'Only owners, admins and reviewers can reject posts' using errcode = '42501';
  end if;
  if v_post.status <> 'pending_approval' then raise exception 'This post is not waiting for approval' using errcode = 'P0002'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs to change' using errcode = '22023'; end if;

  update posts set status = 'draft', scheduled_at = null, review_note = trim(p_note), reviewed_by = p_actor, reviewed_at = now()
   where id = p_post;
  insert into post_reviews (org_id, brand_id, post_id, action, actor_id, note)
  values (v_post.org_id, v_post.brand_id, p_post, 'rejected', p_actor, trim(p_note));
  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_post.org_id, v_post.brand_id, 'user', p_actor, 'post.rejected', 'post', p_post);
end $$;

-- Author (or any editor) takes a waiting post back to edit it.
create or replace function public.withdraw_post(p_post uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_post posts%rowtype;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;
  if coalesce(member_role(v_post.org_id, p_actor), '') not in ('owner','admin','manager') then
    raise exception 'You cannot edit posts in this workspace' using errcode = '42501';
  end if;
  if v_post.status <> 'pending_approval' then raise exception 'This post is not waiting for approval' using errcode = 'P0002'; end if;

  update posts set status = 'draft', scheduled_at = null where id = p_post;
  insert into post_reviews (org_id, brand_id, post_id, action, actor_id) values (v_post.org_id, v_post.brand_id, p_post, 'withdrawn', p_actor);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'is_approver(uuid, uuid)',
    'submit_post_for_approval(uuid, timestamptz, uuid)',
    'approve_post(uuid, uuid, text)',
    'reject_post(uuid, uuid, text)',
    'withdraw_post(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
