-- OAuth connection flow + encrypted token storage (Supabase Vault).
-- Tokens are never stored in plain tables. All functions here are service-role only.

-- One row per in-progress "Connect account" attempt. Expires after 15 minutes.
create table public.oauth_states (
  id              uuid primary key default gen_random_uuid(),
  state_hash      text not null unique,        -- sha256 of the random state sent to the provider
  org_id          uuid not null references public.organizations(id) on delete cascade,
  brand_id        uuid not null references public.brands(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null check (provider in ('meta','linkedin','x','tiktok','youtube','threads')),
  code_verifier   text,                        -- PKCE verifier, for providers that use it
  -- After the callback: accounts the user can choose from, and the vault secret
  -- holding the credentials for them until the choice is made.
  candidates      jsonb,
  secret_id       uuid,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '15 minutes'
);
alter table public.oauth_states enable row level security; -- no policies: server only

create or replace function public.store_secret(p_secret text, p_existing uuid default null)
returns uuid language plpgsql security definer set search_path = public, vault as $$
begin
  if p_existing is not null then
    perform vault.update_secret(p_existing, p_secret);
    return p_existing;
  end if;
  return vault.create_secret(p_secret);
end $$;

create or replace function public.read_secret(p_id uuid)
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

create or replace function public.delete_secret(p_id uuid)
returns void language sql security definer set search_path = public, vault as $$
  delete from vault.secrets where id = p_id;
$$;

-- Connect (or reconnect) an account and store its credentials in one transaction.
-- p_credentials is JSON: {access_token, refresh_token?, expires_at?, ...provider extras}
create or replace function public.connect_social_account(
  p_org uuid, p_brand uuid, p_platform text, p_external_id text, p_display_name text,
  p_avatar_url text, p_credentials text, p_token_expires_at timestamptz, p_scopes text[], p_actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_account social_accounts%rowtype;
  v_secret uuid;
begin
  select * into v_account from social_accounts
   where brand_id = p_brand and platform = p_platform and external_account_id = p_external_id
   for update;

  v_secret := store_secret(p_credentials, v_account.token_ref);

  insert into social_accounts (org_id, brand_id, platform, external_account_id, display_name, avatar_url,
                               status, status_reason, token_ref, token_expires_at, scopes, connected_by)
  values (p_org, p_brand, p_platform, p_external_id, p_display_name, p_avatar_url,
          'active', null, v_secret, p_token_expires_at, coalesce(p_scopes, '{}'), p_actor)
  on conflict (brand_id, platform, external_account_id) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        status = 'active',
        status_reason = null,
        token_ref = excluded.token_ref,
        token_expires_at = excluded.token_expires_at,
        scopes = excluded.scopes,
        connected_by = excluded.connected_by
  returning * into v_account;

  -- Jobs paused because this account had expired can run again.
  update publish_jobs set status = 'scheduled', scheduled_at = greatest(scheduled_at, now()),
         last_error_class = null, last_error_message = null
   where social_account_id = v_account.id and status = 'paused';

  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (p_org, p_brand, 'user', p_actor, 'social_account.connected', 'social_account', v_account.id,
          jsonb_build_object('platform', p_platform));
  return v_account.id;
end $$;

-- Update stored credentials after a token refresh.
create or replace function public.update_account_credentials(p_account uuid, p_credentials text, p_token_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref uuid;
begin
  select token_ref into v_ref from social_accounts where id = p_account for update;
  if not found then raise exception 'account not found'; end if;
  update social_accounts
     set token_ref = store_secret(p_credentials, v_ref), token_expires_at = p_token_expires_at
   where id = p_account;
end $$;

-- Disconnecting deletes the stored credentials.
create or replace function public.revoke_social_account(p_account uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_account social_accounts%rowtype;
begin
  select * into v_account from social_accounts where id = p_account for update;
  if not found then raise exception 'account not found'; end if;
  if exists (select 1 from publish_jobs where social_account_id = p_account
             and status in ('scheduled','publishing','processing','retrying')) then
    raise exception 'account has scheduled posts; cancel them first';
  end if;
  if v_account.token_ref is not null then perform delete_secret(v_account.token_ref); end if;
  update social_accounts set status = 'revoked', status_reason = 'Disconnected by user', token_ref = null
   where id = p_account;
  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_account.org_id, v_account.brand_id, 'user', p_actor, 'social_account.disconnected', 'social_account', p_account);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'store_secret(text, uuid)', 'read_secret(uuid)', 'delete_secret(uuid)',
    'connect_social_account(uuid, uuid, text, text, text, text, text, timestamptz, text[], uuid)',
    'update_account_credentials(uuid, text, timestamptz)', 'revoke_social_account(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
