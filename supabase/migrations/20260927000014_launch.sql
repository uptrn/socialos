-- SocialOS: launch readiness.
--  * system_heartbeats: each scheduled job records when it last ran (shown on the setup checklist)
--  * delete_organization: an owner permanently deletes a workspace and everything in it
--  * invitation rate limit

create table public.system_heartbeats (
  name         text primary key,
  last_run_at  timestamptz not null,
  last_ok      boolean not null,
  details      jsonb not null default '{}'
);
alter table public.system_heartbeats enable row level security; -- server only, no policies

-- Permanently deletes an organization. The app first cancels billing and removes stored files.
-- Deletes stored platform tokens (Vault) explicitly; everything else goes with the org.
create or replace function public.delete_organization(p_org uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if coalesce(member_role(p_org, p_actor), '') <> 'owner' then
    raise exception 'Only owners can delete the organization' using errcode = '42501';
  end if;
  perform 1 from organizations where id = p_org for update;

  delete from vault.secrets where id in (select token_ref from social_accounts where org_id = p_org and token_ref is not null);
  delete from vault.secrets where id in (select secret_id from oauth_states where org_id = p_org and secret_id is not null);
  -- Posts first: publish jobs and variants reference accounts with ON DELETE RESTRICT.
  delete from posts where org_id = p_org;
  delete from organizations where id = p_org;
end $$;
revoke all on function public.delete_organization(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_organization(uuid, uuid) to service_role;

-- Organizations a user is the only owner of (they must delete or hand these over before deleting their account).
create or replace function public.sole_owned_orgs(p_user uuid)
returns table (org_id uuid, name text) language sql stable security definer set search_path = public as $$
  select o.id, o.name from organizations o
   where exists (select 1 from org_members m where m.org_id = o.id and m.user_id = p_user and m.role = 'owner' and m.status = 'active')
     and (select count(*) from org_members m where m.org_id = o.id and m.role = 'owner' and m.status = 'active') = 1;
$$;
revoke all on function public.sole_owned_orgs(uuid) from public, anon, authenticated;
grant execute on function public.sole_owned_orgs(uuid) to service_role;

-- Deleting a user account keeps the organization's content; these columns just forget who it was.
alter table public.social_accounts drop constraint social_accounts_connected_by_fkey,
  add constraint social_accounts_connected_by_fkey foreign key (connected_by) references auth.users(id) on delete set null;
alter table public.media_assets drop constraint media_assets_created_by_fkey,
  add constraint media_assets_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.posts drop constraint posts_created_by_fkey,
  add constraint posts_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.brand_profiles drop constraint brand_profiles_updated_by_fkey,
  add constraint brand_profiles_updated_by_fkey foreign key (updated_by) references auth.users(id) on delete set null;
alter table public.agent_runs drop constraint agent_runs_created_by_fkey,
  add constraint agent_runs_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- At most 30 invitations per organization per hour (limits abuse of invitation emails).
create or replace function public.limit_invitations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from org_invitations where org_id = new.org_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many invitations in the last hour. Try again later.' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger org_invitations_rate_limit before insert on public.org_invitations
  for each row execute function public.limit_invitations();
