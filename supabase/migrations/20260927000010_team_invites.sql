-- SocialOS: team invitations and member management.
-- Members are changed only through the service-role functions below, which enforce:
--   * owners and admins invite; nobody can invite an owner (owners promote existing members)
--   * only owners can change or remove owners, or make someone an owner
--   * an organization always keeps at least one owner
-- Invitation links carry a random token; only its SHA-256 hash is stored.

-- Admins could previously write org_members directly (e.g. make themselves owner). Reads stay as before.
drop policy if exists members_manage on public.org_members;

create table public.org_invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  email        text not null check (email = lower(email) and email like '%_@_%' and length(email) <= 320),
  role         text not null check (role in ('admin','manager','reviewer','viewer')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
-- One open invitation per email per organization (resending rotates its token).
create unique index org_invitations_open_idx on public.org_invitations(org_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.org_invitations enable row level security;
create policy invitations_read on public.org_invitations for select
  using (public.has_org_role(org_id, array['owner','admin']));

-- Role of a user in an org, or null.
create or replace function public.member_role(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from org_members where org_id = p_org and user_id = p_user and status = 'active';
$$;

-- Creates (or refreshes) an invitation. Returns its id.
create or replace function public.create_org_invitation(p_org uuid, p_email text, p_role text, p_token_hash text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor_role text := member_role(p_org, p_actor);
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'Only owners and admins can invite people' using errcode = '42501';
  end if;
  if p_role not in ('admin','manager','reviewer','viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if exists (select 1 from org_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and m.status = 'active' and lower(u.email) = v_email) then
    raise exception 'This person is already a member' using errcode = '23505';
  end if;

  update org_invitations set role = p_role, token_hash = p_token_hash, invited_by = p_actor,
         expires_at = now() + interval '7 days', created_at = now()
   where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null
  returning id into v_id;
  if v_id is null then
    insert into org_invitations (org_id, email, role, token_hash, invited_by)
    values (p_org, v_email, p_role, p_token_hash, p_actor) returning id into v_id;
  end if;

  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (p_org, 'user', p_actor, 'member.invited', 'invitation', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end $$;

-- Accepts an invitation for a signed-in user whose email matches. Returns the org id.
create or replace function public.accept_org_invitation(p_token_hash text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_inv org_invitations;
  v_email text;
  v_existing text;
begin
  select * into v_inv from org_invitations where token_hash = p_token_hash for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'This invitation is no longer valid' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = p_user then return v_inv.org_id; end if;
    raise exception 'This invitation has already been used' using errcode = 'P0002';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'P0002';
  end if;

  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is distinct from v_inv.email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  select role into v_existing from org_members where org_id = v_inv.org_id and user_id = p_user and status = 'active';
  if v_existing is null then
    insert into org_members (org_id, user_id, role, status) values (v_inv.org_id, p_user, v_inv.role, 'active')
    on conflict (org_id, user_id) do update set role = excluded.role, status = 'active';
  end if;

  update org_invitations set accepted_at = now(), accepted_by = p_user where id = v_inv.id;
  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (v_inv.org_id, 'user', p_user, 'member.joined', 'invitation', v_inv.id, jsonb_build_object('role', coalesce(v_existing, v_inv.role)));
  return v_inv.org_id;
end $$;

create or replace function public.revoke_org_invitation(p_invitation uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from org_invitations where id = p_invitation and accepted_at is null and revoked_at is null;
  if v_org is null then return; end if;
  if coalesce(member_role(v_org, p_actor), '') not in ('owner','admin') then
    raise exception 'Only owners and admins can cancel invitations' using errcode = '42501';
  end if;
  update org_invitations set revoked_at = now() where id = p_invitation;
  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_org, 'user', p_actor, 'member.invitation_revoked', 'invitation', p_invitation);
end $$;

-- Changes a member's role, or removes them (p_role = null). Members may remove themselves (leave).
create or replace function public.update_org_member(p_org uuid, p_user uuid, p_role text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor_role text := member_role(p_org, p_actor);
  v_target_role text;
  v_owners int;
begin
  -- Serialize membership changes per org so the "last owner" check can't race.
  perform 1 from organizations where id = p_org for update;
  v_target_role := member_role(p_org, p_user);
  if v_target_role is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if p_role is not null and p_role not in ('owner','admin','manager','reviewer','viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;

  if p_role is null and p_user = p_actor then
    null; -- leaving is always allowed (subject to the last-owner rule)
  elsif coalesce(v_actor_role, '') not in ('owner','admin') then
    raise exception 'Only owners and admins can manage members' using errcode = '42501';
  elsif v_actor_role <> 'owner' and (v_target_role = 'owner' or p_role = 'owner') then
    raise exception 'Only owners can change owners' using errcode = '42501';
  end if;

  if v_target_role = 'owner' and (p_role is null or p_role <> 'owner') then
    select count(*) into v_owners from org_members where org_id = p_org and role = 'owner' and status = 'active';
    if v_owners <= 1 then
      raise exception 'An organization needs at least one owner. Make someone else an owner first.' using errcode = '23514';
    end if;
  end if;

  if p_role is null then
    update org_members set status = 'removed' where org_id = p_org and user_id = p_user;
  else
    update org_members set role = p_role where org_id = p_org and user_id = p_user;
  end if;
  insert into audit_logs (org_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (p_org, 'user', p_actor, case when p_role is null then 'member.removed' else 'member.role_changed' end,
          'user', p_user, jsonb_build_object('from', v_target_role, 'to', p_role));
end $$;

-- Members with their email addresses (auth.users is not readable by clients).
create or replace function public.org_member_list(p_org uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.role, m.created_at
    from org_members m join auth.users u on u.id = m.user_id
   where m.org_id = p_org and m.status = 'active'
   order by case m.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 when 'reviewer' then 3 else 4 end, u.email;
$$;

-- Organization name and role for an invitation page (by token hash).
create or replace function public.invitation_preview(p_token_hash text)
returns table (org_name text, email text, role text, status text)
language sql stable security definer set search_path = public as $$
  select o.name, i.email, i.role,
         case when i.revoked_at is not null then 'revoked'
              when i.accepted_at is not null then 'accepted'
              when i.expires_at < now() then 'expired'
              else 'open' end
    from org_invitations i join organizations o on o.id = i.org_id
   where i.token_hash = p_token_hash;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'member_role(uuid, uuid)',
    'create_org_invitation(uuid, text, text, text, uuid)',
    'accept_org_invitation(text, uuid)',
    'revoke_org_invitation(uuid, uuid)',
    'update_org_member(uuid, uuid, text, uuid)',
    'org_member_list(uuid)',
    'invitation_preview(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
