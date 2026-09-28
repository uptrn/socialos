-- Email recipients for operational alerts (failed posts, expiring connections).
-- Owners and admins of the organization, plus an optional extra user (e.g. the post's author).

create or replace function public.org_alert_recipients(p_org uuid, p_extra_user uuid default null)
returns table (user_id uuid, email text) language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text
    from auth.users u
   where u.email is not null
     and (
       exists (select 1 from org_members m
                where m.org_id = p_org and m.user_id = u.id and m.status = 'active' and m.role in ('owner','admin'))
       or (p_extra_user is not null and u.id = p_extra_user
           and exists (select 1 from org_members m where m.org_id = p_org and m.user_id = u.id and m.status = 'active'))
     );
$$;
revoke all on function public.org_alert_recipients(uuid, uuid) from public, anon, authenticated;
grant execute on function public.org_alert_recipients(uuid, uuid) to service_role;

-- Clean up abandoned "Connect account" attempts, including any parked credentials.
create or replace function public.purge_expired_oauth_states()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in select id, secret_id from oauth_states where expires_at < now() loop
    if v_row.secret_id is not null then perform delete_secret(v_row.secret_id); end if;
    delete from oauth_states where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.purge_expired_oauth_states() from public, anon, authenticated;
grant execute on function public.purge_expired_oauth_states() to service_role;
