-- Transactional post operations.
-- save_post_draft runs as the calling user (RLS applies).
-- schedule/cancel/retry run as the service role, called by the server after it has
-- checked permissions and validated content against platform rules.

-- p_post: {
--   id?: uuid, brand_id: uuid, title?: text,
--   variants: [{ social_account_id, platform, post_type, caption, thread_parts: text[],
--                options: jsonb, validation: jsonb, media: [{ media_id, alt_text? }] }]
-- }
create or replace function public.save_post_draft(p_post jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_post_id uuid := nullif(p_post->>'id', '')::uuid;
  v_brand uuid := (p_post->>'brand_id')::uuid;
  v_org uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_media jsonb;
  v_pos int;
begin
  select org_id into v_org from brands where id = v_brand;
  if v_org is null then
    raise exception 'brand not found';
  end if;

  if v_post_id is null then
    insert into posts (org_id, brand_id, title, created_by)
    values (v_org, v_brand, nullif(p_post->>'title', ''), auth.uid())
    returning id into v_post_id;
  else
    update posts set title = nullif(p_post->>'title', '')
     where id = v_post_id and brand_id = v_brand and status = 'draft';
    if not found then
      raise exception 'post is not an editable draft';
    end if;
    -- Replace variants wholesale; drafts have no publish jobs.
    delete from post_variants where post_id = v_post_id;
  end if;

  for v_variant in select * from jsonb_array_elements(coalesce(p_post->'variants', '[]'::jsonb)) loop
    insert into post_variants (org_id, brand_id, post_id, social_account_id, platform, post_type,
                               caption, thread_parts, options, validation, status)
    values (v_org, v_brand, v_post_id,
            (v_variant->>'social_account_id')::uuid,
            v_variant->>'platform',
            v_variant->>'post_type',
            coalesce(v_variant->>'caption', ''),
            coalesce(array(select jsonb_array_elements_text(v_variant->'thread_parts')), '{}'),
            coalesce(v_variant->'options', '{}'::jsonb),
            coalesce(v_variant->'validation', '[]'::jsonb),
            'draft')
    returning id into v_variant_id;

    v_pos := 0;
    for v_media in select * from jsonb_array_elements(coalesce(v_variant->'media', '[]'::jsonb)) loop
      if not exists (select 1 from media_assets where id = (v_media->>'media_id')::uuid and brand_id = v_brand and status = 'ready') then
        raise exception 'media % is not available for this brand', v_media->>'media_id';
      end if;
      insert into variant_media (variant_id, media_id, position, alt_text)
      values (v_variant_id, (v_media->>'media_id')::uuid, v_pos, nullif(v_media->>'alt_text', ''));
      v_pos := v_pos + 1;
    end loop;
  end loop;

  return v_post_id;
end $$;
revoke all on function public.save_post_draft(jsonb) from public, anon;
grant execute on function public.save_post_draft(jsonb) to authenticated;

-- Create one publish job per variant. Idempotency key includes the variant revision,
-- so re-scheduling an edited post never collides with an old job.
create or replace function public.schedule_post(p_post uuid, p_at timestamptz, p_actor uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_post posts%rowtype;
  v_count int;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;
  if v_post.status <> 'draft' then raise exception 'only drafts can be scheduled (post is %)', v_post.status; end if;

  if exists (
    select 1 from post_variants v join social_accounts a on a.id = v.social_account_id
     where v.post_id = p_post and a.status <> 'active'
  ) then
    raise exception 'a selected social account is disconnected';
  end if;

  insert into publish_jobs (org_id, brand_id, post_id, variant_id, social_account_id, platform, scheduled_at, idempotency_key)
  select v.org_id, v.brand_id, v.post_id, v.id, v.social_account_id, v.platform, p_at,
         v.id || ':' || v.social_account_id || ':r' || v.revision
    from post_variants v
   where v.post_id = p_post;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'post has no platforms selected'; end if;

  update post_variants set status = 'scheduled' where post_id = p_post;
  update posts set status = 'scheduled', scheduled_at = p_at where id = p_post;

  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (v_post.org_id, v_post.brand_id, 'user', p_actor, 'post.scheduled', 'post', p_post,
          jsonb_build_object('scheduled_at', p_at, 'jobs', v_count));
  return v_count;
end $$;
revoke all on function public.schedule_post(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.schedule_post(uuid, timestamptz, uuid) to service_role;

-- Unschedule a post back to draft. Refuses while any job is mid-publish or already live.
create or replace function public.cancel_post(p_post uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_post posts%rowtype;
begin
  select * into v_post from posts where id = p_post for update;
  if not found then raise exception 'post not found'; end if;

  if exists (select 1 from publish_jobs where post_id = p_post and status in ('publishing','processing')) then
    raise exception 'post is being published right now; try again in a minute';
  end if;
  if exists (select 1 from publish_jobs where post_id = p_post and status = 'published') then
    raise exception 'post is already live on at least one platform; delete it on the platform instead';
  end if;

  update publish_jobs set status = 'cancelled'
   where post_id = p_post and status not in ('cancelled');
  -- New revision => new idempotency keys if it is scheduled again.
  update post_variants set status = 'draft', revision = revision + 1 where post_id = p_post;
  update posts set status = 'draft', scheduled_at = null where id = p_post;

  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_post.org_id, v_post.brand_id, 'user', p_actor, 'post.cancelled', 'post', p_post);
end $$;
revoke all on function public.cancel_post(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_post(uuid, uuid) to service_role;

-- A person decided to try a stopped job again (after checking the platform for needs_check).
create or replace function public.retry_publish_job(p_job uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_job publish_jobs%rowtype;
begin
  select * into v_job from publish_jobs where id = p_job for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status not in ('failed','needs_check','missed','paused') then
    raise exception 'job cannot be retried from status %', v_job.status;
  end if;
  if exists (select 1 from social_accounts where id = v_job.social_account_id and status <> 'active') then
    raise exception 'reconnect the social account before retrying';
  end if;

  update publish_jobs
     set status = 'scheduled', scheduled_at = now(), next_attempt_at = null,
         attempt_count = 0, locked_at = null, resume_state = null,
         last_error_class = null, last_error_message = null
   where id = p_job;
  perform refresh_post_status(v_job.post_id);

  insert into audit_logs (org_id, brand_id, actor_type, actor_id, action, resource_type, resource_id, details)
  values (v_job.org_id, v_job.brand_id, 'user', p_actor, 'publish_job.retried', 'publish_job', p_job,
          jsonb_build_object('from_status', v_job.status));
end $$;
revoke all on function public.retry_publish_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retry_publish_job(uuid, uuid) to service_role;
