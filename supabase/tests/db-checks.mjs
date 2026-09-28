import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Applies all migrations to an in-memory Postgres (PGlite) with Supabase auth/storage stubbed,
// then checks tenant isolation and scheduler invariants. Run: npm run test:db
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const db = new PGlite();
const stub = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text);
create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text) returns uuid language sql as $$ insert into vault.secrets (secret) values (new_secret) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;

create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth, storage to authenticated, service_role, anon;
`;
await db.exec(stub);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
await db.exec(`grant all on all tables in schema public to authenticated, service_role;
               grant all on all sequences in schema public to authenticated, service_role;`);
console.log('migration applied');

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${U1}', 'owner1@example.com'), ('${U2}', 'owner2@example.com')`);

async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
}
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) process.exitCode = 1; };

const o1 = (await as(U1, `select create_organization('Acme', 'acme', 'Acme App', 'Asia/Kolkata') as id`)).rows[0].id;
const o2 = (await as(U2, `select create_organization('Other', 'other', 'Other App') as id`)).rows[0].id;
check('org creation makes owner + brand', (await as(U1, 'select * from brands')).rows.length === 1);
check('user 1 cannot see org 2 brands', (await as(U1, `select * from brands where org_id = '${o2}'`)).rows.length === 0);

const b1 = (await as(U1, 'select id from brands')).rows[0].id;
const b2 = (await as(U2, 'select id from brands')).rows[0].id;

// service role (worker/server) inserts an account
await db.exec(`insert into social_accounts (id, org_id, brand_id, platform, external_account_id, display_name)
               values ('aaaaaaaa-0000-0000-0000-000000000001', '${o1}', '${b1}', 'linkedin', 'li-1', 'Acme LI')`);
let blocked = false;
try { await db.exec(`insert into social_accounts (org_id, brand_id, platform, external_account_id, display_name)
                     values ('${o1}', '${b2}', 'x', 'x-1', 'wrong')`); } catch { blocked = true; }
check('brand/org mismatch rejected', blocked);

const post = (await as(U1, `insert into posts (org_id, brand_id, title) values ('${o1}', '${b1}', 'Launch') returning id`)).rows[0].id;
const variant = (await as(U1, `insert into post_variants (org_id, brand_id, post_id, social_account_id, platform, post_type, caption)
   values ('${o1}', '${b1}', '${post}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', 'text', 'Hello') returning id`)).rows[0].id;
check('user can create draft post + variant', !!variant);

blocked = false;
try { await as(U2, `insert into posts (org_id, brand_id, title) values ('${o1}', '${b1}', 'hijack')`); } catch { blocked = true; }
check('user 2 cannot write into org 1', blocked);

blocked = false;
try { await as(U1, `insert into publish_jobs (org_id, brand_id, post_id, variant_id, social_account_id, platform, scheduled_at, idempotency_key)
     values ('${o1}', '${b1}', '${post}', '${variant}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', now(), 'k')`); } catch { blocked = true; }
check('users cannot create publish jobs directly', blocked);

// server schedules two jobs
await db.exec(`insert into publish_jobs (org_id, brand_id, post_id, variant_id, social_account_id, platform, scheduled_at, idempotency_key) values
  ('${o1}', '${b1}', '${post}', '${variant}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', now() - interval '1 minute', 'k1'),
  ('${o1}', '${b1}', '${post}', '${variant}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', now() + interval '1 day', 'k2')`);
blocked = false;
try { await db.exec(`insert into publish_jobs (org_id, brand_id, post_id, variant_id, social_account_id, platform, scheduled_at, idempotency_key)
  values ('${o1}', '${b1}', '${post}', '${variant}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', now(), 'k1')`); } catch { blocked = true; }
check('duplicate idempotency key rejected', blocked);

const claimed = (await db.query(`select * from claim_due_publish_jobs(now(), 10)`)).rows;
check('claim returns only due job', claimed.length === 1 && claimed[0].idempotency_key === 'k1' && claimed[0].status === 'publishing' && claimed[0].attempt_count === 1);
check('second claim returns nothing', (await db.query(`select * from claim_due_publish_jobs(now(), 10)`)).rows.length === 0);

blocked = false;
try { await as(U1, `select * from claim_due_publish_jobs(now(), 10)`); } catch { blocked = true; }
check('users cannot call claim function', blocked);

// stale lock recovery
await db.query(`update publish_jobs set locked_at = now() - interval '20 minutes' where idempotency_key = 'k1'`);
await db.query(`select * from claim_due_publish_jobs(now(), 10)`);
check('stale publishing job moved to needs_check', (await db.query(`select status from publish_jobs where idempotency_key='k1'`)).rows[0].status === 'needs_check');

blocked = false;
try { await db.exec(`update publish_jobs set status = 'published' where idempotency_key = 'k2'`); } catch { blocked = true; }
check('published requires external id', blocked);

await db.exec(`update publish_jobs set status='published', external_post_id='x' where idempotency_key='k2'`);
await db.query(`select refresh_post_status('${post}')`);
check('post status partially_published', (await db.query(`select status from posts where id='${post}'`)).rows[0].status === 'partially_published');

const transitions = (await as(U1, `select to_status from status_transitions order by id`)).rows.map((r) => r.to_status);
check('transitions recorded + visible to member', transitions.includes('publishing') && transitions.includes('needs_check'));
check('user 2 sees no transitions', (await as(U2, 'select * from status_transitions')).rows.length === 0);

// ---- post functions ----
await db.exec(`insert into media_assets (id, org_id, brand_id, kind, mime_type, size_bytes, storage_path)
               values ('bbbbbbbb-0000-0000-0000-000000000001', '${o1}', '${b1}', 'image', 'image/jpeg', 1000, 'p1')`);
const draftId = (await as(U1, `select save_post_draft('${JSON.stringify({
  brand_id: b1, title: 'Draft A',
  variants: [{ social_account_id: 'aaaaaaaa-0000-0000-0000-000000000001', platform: 'linkedin', post_type: 'image',
               caption: 'hi', thread_parts: [], options: {}, validation: [], media: [{ media_id: 'bbbbbbbb-0000-0000-0000-000000000001' }] }],
})}'::jsonb) as id`)).rows[0].id;
check('save_post_draft creates post, variant and media link',
  (await as(U1, `select count(*)::int as n from variant_media vm join post_variants v on v.id = vm.variant_id where v.post_id = '${draftId}'`)).rows[0].n === 1);

blocked = false;
try { await as(U2, `select save_post_draft('${JSON.stringify({ id: draftId, brand_id: b1, variants: [] })}'::jsonb)`); } catch { blocked = true; }
check('other org cannot overwrite a draft', blocked);

const jobsCreated = (await db.query(`select schedule_post('${draftId}', now() - interval '1 second', '${U1}') as n`)).rows[0].n;
check('schedule_post creates one job per variant', jobsCreated === 1);
check('post is now scheduled', (await db.query(`select status from posts where id='${draftId}'`)).rows[0].status === 'scheduled');

blocked = false;
try { await as(U1, `select save_post_draft('${JSON.stringify({ id: draftId, brand_id: b1, variants: [] })}'::jsonb)`); } catch { blocked = true; }
check('scheduled post cannot be edited as a draft', blocked);

blocked = false;
try { await as(U1, `select schedule_post('${draftId}', now(), '${U1}')`); } catch { blocked = true; }
check('users cannot call schedule_post directly', blocked);

await db.query(`select cancel_post('${draftId}', '${U1}')`);
const afterCancel = (await db.query(`select p.status, v.revision from posts p join post_variants v on v.post_id = p.id where p.id='${draftId}'`)).rows[0];
check('cancel returns post to draft and bumps revision', afterCancel.status === 'draft' && afterCancel.revision === 2);
await db.query(`select schedule_post('${draftId}', now() - interval '1 second', '${U1}')`);
check('re-scheduling after cancel gets a new idempotency key',
  (await db.query(`select count(distinct idempotency_key)::int as n from publish_jobs where post_id='${draftId}'`)).rows[0].n === 2);

const claimedAgain = (await db.query(`select * from claim_due_publish_jobs(now(), 10)`)).rows.filter((r) => r.post_id === draftId);
check('only the live (non-cancelled) job is claimed', claimedAgain.length === 1);
blocked = false;
try { await db.query(`select cancel_post('${draftId}', '${U1}')`); } catch { blocked = true; }
check('cannot cancel while publishing', blocked);

await db.query(`update publish_jobs set status='needs_check' where id='${claimedAgain[0].id}'`);
await db.query(`select retry_publish_job('${claimedAgain[0].id}', '${U1}')`);
check('retry puts a needs_check job back in the queue',
  (await db.query(`select status, attempt_count from publish_jobs where id='${claimedAgain[0].id}'`)).rows[0].status === 'scheduled');

// ---- OAuth tokens ----
const acc = (await db.query(`select connect_social_account('${o1}', '${b1}', 'facebook', 'page-1', 'Acme Page', null,
  '{"access_token":"secret-token"}', null, array['pages_manage_posts'], '${U1}') as id`)).rows[0].id;
const tokenRef = (await db.query(`select token_ref from social_accounts where id='${acc}'`)).rows[0].token_ref;
check('connect stores credentials in vault', (await db.query(`select read_secret('${tokenRef}') as t`)).rows[0].t.includes('secret-token'));
check('token not visible in social_accounts row', !JSON.stringify((await as(U1, `select * from social_accounts where id='${acc}'`)).rows[0]).includes('secret-token'));

blocked = false;
try { await as(U1, `select read_secret('${tokenRef}')`); } catch { blocked = true; }
check('users cannot read secrets', blocked);

await db.query(`select connect_social_account('${o1}', '${b1}', 'facebook', 'page-1', 'Acme Page 2', null, '{"access_token":"new-token"}', null, null, '${U1}')`);
const again = (await db.query(`select token_ref, display_name from social_accounts where id='${acc}'`)).rows[0];
check('reconnect updates the same account and secret', again.token_ref === tokenRef && again.display_name === 'Acme Page 2'
  && (await db.query(`select read_secret('${tokenRef}') as t`)).rows[0].t.includes('new-token'));

await db.query(`select revoke_social_account('${acc}', '${U1}')`);
check('revoke deletes the secret', (await db.query(`select count(*)::int as n from vault.secrets where id='${tokenRef}'`)).rows[0].n === 0);

blocked = false;
try { await as(U1, `select * from oauth_states`); blocked = (await as(U1, `select * from oauth_states`)).rows.length === 0; } catch { blocked = true; }
check('oauth_states hidden from users', blocked);

// ---- notifications ----
const recipients = (await db.query(`select email from org_alert_recipients('${o1}')`)).rows.map((r) => r.email);
check('alert recipients are the org owners only', recipients.length === 1 && recipients[0] === 'owner1@example.com');
check('extra user outside the org is not added', (await db.query(`select email from org_alert_recipients('${o1}', '${U2}')`)).rows.length === 1);
blocked = false;
try { await as(U1, `select * from org_alert_recipients('${o1}')`); } catch { blocked = true; }
check('users cannot list alert recipients', blocked);

const sid = (await db.query(`select store_secret('parked') as id`)).rows[0].id;
await db.exec(`insert into oauth_states (state_hash, org_id, brand_id, user_id, provider, secret_id, expires_at)
               values ('h-old', '${o1}', '${b1}', '${U1}', 'x', '${sid}', now() - interval '1 minute')`);
const purged = (await db.query(`select purge_expired_oauth_states() as n`)).rows[0].n;
check('expired connection attempts and their secrets are purged',
  purged === 1 && (await db.query(`select count(*)::int as n from vault.secrets where id='${sid}'`)).rows[0].n === 0);

// ---- brand brain + agent runs ----
await as(U1, `insert into brand_profiles (brand_id, org_id, description, approved_claims) values ('${b1}', '${o1}', 'Invoicing for builders', array['Free 14-day trial'])`);
check('editor can write their brand profile', (await as(U1, `select description from brand_profiles where brand_id='${b1}'`)).rows[0]?.description === 'Invoicing for builders');
blocked = false;
try { await as(U2, `insert into brand_profiles (brand_id, org_id) values ('${b1}', '${o1}')`); } catch { blocked = true; }
check('other org cannot write a brand profile', blocked);
check('other org cannot read the brand profile', (await as(U2, `select * from brand_profiles where brand_id='${b1}'`)).rows.length === 0);

await db.exec(`insert into agent_runs (org_id, brand_id, agent, model, status, cost_usd) values
  ('${o1}', '${b1}', 'content', 'claude-opus-5', 'succeeded', 0.0125),
  ('${o1}', '${b1}', 'qa', 'claude-opus-5', 'succeeded', 0.0075),
  ('${o2}', '${b2}', 'content', 'claude-opus-5', 'succeeded', 1.0)`);
check('monthly AI spend is per organization',
  Number((await db.query(`select org_ai_spend_this_month('${o1}') as s`)).rows[0].s) === 0.02);
blocked = false;
try { await as(U1, `insert into agent_runs (org_id, agent, model, status) values ('${o1}', 'x', 'm', 'succeeded')`); } catch { blocked = true; }
check('users cannot write agent runs', blocked);

// ---- research ----
await db.exec(`insert into research_items (org_id, brand_id, topic, summary, why_relevant, angle, priority)
               values ('${o1}', '${b1}', 'Topic', 'S', 'W', 'A', 7)`);
const item = (await as(U1, `select id from research_items where brand_id='${b1}'`)).rows[0];
check('members see their research items', !!item);
check('other org cannot see research items', (await as(U2, `select * from research_items`)).rows.length === 0);
await as(U1, `update research_items set status='saved' where id='${item.id}'`);
check('editors can save an item', (await db.query(`select status from research_items where id='${item.id}'`)).rows[0].status === 'saved');
blocked = false;
try { await as(U1, `insert into research_items (org_id, brand_id, topic, summary, why_relevant, angle, priority) values ('${o1}', '${b1}', 't','s','w','a',5)`); } catch { blocked = true; }
check('users cannot create research items directly', blocked);

await db.exec(`update brand_profiles set research_weekly = true where brand_id='${b1}'`);
check('brand with weekly research and no recent run is due',
  (await db.query(`select brand_id from brands_due_for_research()`)).rows.some((r) => r.brand_id === b1));
await db.exec(`insert into agent_runs (org_id, brand_id, agent, model, status) values ('${o1}', '${b1}', 'research', 'm', 'succeeded')`);
check('brand researched this week is not due',
  !(await db.query(`select brand_id from brands_due_for_research()`)).rows.some((r) => r.brand_id === b1));

// ---- brand visuals ----
blocked = false;
try { await as(U1, `update brand_profiles set color_primary = 'blue' where brand_id='${b1}'`); } catch { blocked = true; }
check('brand colors must be hex', blocked);
await as(U1, `update brand_profiles set color_primary = '#FF6600', visual_style = 'flat' where brand_id='${b1}'`);
check('valid brand color saved', (await db.query(`select color_primary from brand_profiles where brand_id='${b1}'`)).rows[0].color_primary === '#FF6600');
check('media assets default to upload source', (await db.query(`select source from media_assets limit 1`)).rows[0].source === 'upload');

// ---- stock media source ----
await db.exec(`insert into media_assets (org_id, brand_id, kind, mime_type, size_bytes, storage_path, source)
               values ('${o1}', '${b1}', 'image', 'image/jpeg', 10, 'stock-1', 'stock')`);
check('stock photos can be stored', (await db.query(`select count(*)::int as n from media_assets where source='stock'`)).rows[0].n === 1);
blocked = false;
try { await db.exec(`insert into media_assets (org_id, brand_id, kind, mime_type, size_bytes, storage_path, source) values ('${o1}', '${b1}', 'image', 'image/jpeg', 10, 'x-2', 'other')`); } catch { blocked = true; }
check('unknown media sources are rejected', blocked);

// ---- billing ----
check('existing orgs got a trial', (await db.query(`select status, plan from subscriptions where org_id='${o1}'`)).rows[0]?.status === 'trialing');
const o3 = (await as(U1, `select create_organization('Third', 'third-org', 'Brand Three') as id`)).rows[0].id;
const trial = (await db.query(`select plan, status, trial_ends_at > now() + interval '13 days' as ok from subscriptions where org_id='${o3}'`)).rows[0];
check('new orgs start a 14-day trial', trial?.plan === 'trial' && trial?.status === 'trialing' && trial?.ok === true);
check('members can read their subscription', (await as(U1, `select * from subscriptions where org_id='${o1}'`)).rows.length === 1);
check('other orgs cannot read it', (await as(U2, `select * from subscriptions where org_id='${o1}'`)).rows.length === 0);
blocked = false;
try { await as(U1, `update subscriptions set plan='agency', status='active' where org_id='${o1}'`); blocked = (await db.query(`select plan from subscriptions where org_id='${o1}'`)).rows[0].plan !== 'agency'; } catch { blocked = true; }
check('users cannot upgrade themselves', blocked);
blocked = false;
try { await as(U1, `select * from org_usage_counts('${o2}')`); } catch { blocked = true; }
check('usage counts are server-only', blocked);
const counts = (await db.query(`select * from org_usage_counts('${o1}')`)).rows[0];
check('usage counts brands and non-revoked accounts', counts.brands === 1 && counts.social_accounts >= 1);

// --- Team invites (migration 10) ---
const U3 = '33333333-3333-3333-3333-333333333333';
const U4 = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users values ('${U3}', 'Teammate@Example.com'), ('${U4}', 'stranger@example.com')`);
const H = (c) => c.repeat(64);
const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };

check('admins can no longer write org_members directly',
  await fails(() => as(U1, `insert into org_members (org_id, user_id, role) values ('${o1}', '${U4}', 'owner')`)));
check('non-members cannot invite',
  await fails(() => db.query(`select create_org_invitation('${o1}', 'x@example.com', 'viewer', '${H('0')}', '${U2}')`)));
check('nobody can be invited as owner',
  await fails(() => db.query(`select create_org_invitation('${o1}', 'x@example.com', 'owner', '${H('0')}', '${U1}')`)));
const inv = (await db.query(`select create_org_invitation('${o1}', ' TEAMMATE@example.com ', 'manager', '${H('a')}', '${U1}') as id`)).rows[0].id;
const again2 = (await db.query(`select create_org_invitation('${o1}', 'teammate@example.com', 'reviewer', '${H('b')}', '${U1}') as id`)).rows[0].id;
const invRow = (await db.query(`select email, role, token_hash from org_invitations where id='${inv}'`)).rows[0];
check('re-inviting refreshes the same invitation', inv === again2 && invRow.role === 'reviewer' && invRow.token_hash === H('b') && invRow.email === 'teammate@example.com');
check('users cannot call invitation functions',
  await fails(() => as(U1, `select create_org_invitation('${o1}', 'y@example.com', 'viewer', '${H('c')}', '${U1}')`)));
check('owners can see invitations', (await as(U1, `select * from org_invitations`)).rows.length === 1);
check('other orgs cannot see invitations', (await as(U2, `select * from org_invitations`)).rows.length === 0);
check('old token no longer works', await fails(() => db.query(`select accept_org_invitation('${H('a')}', '${U3}')`)));
check('invitation for another email is refused', await fails(() => db.query(`select accept_org_invitation('${H('b')}', '${U4}')`)));
check('invited user joins with the invited role',
  (await db.query(`select accept_org_invitation('${H('b')}', '${U3}') as org`)).rows[0].org === o1 &&
  (await db.query(`select role from org_members where org_id='${o1}' and user_id='${U3}'`)).rows[0]?.role === 'reviewer');
check('new member sees the org brands', (await as(U3, `select * from brands where org_id='${o1}'`)).rows.length === 1);
check('invitation cannot be reused by someone else', await fails(() => db.query(`select accept_org_invitation('${H('b')}', '${U4}')`)));
check('existing members cannot be invited again',
  await fails(() => db.query(`select create_org_invitation('${o1}', 'teammate@example.com', 'viewer', '${H('d')}', '${U1}')`)));
check('member list shows emails', (await db.query(`select * from org_member_list('${o1}')`)).rows.map((r) => r.email).join() === 'owner1@example.com,Teammate@Example.com');
check('reviewers cannot change roles', await fails(() => db.query(`select update_org_member('${o1}', '${U3}', 'admin', '${U3}')`)));
await db.query(`select update_org_member('${o1}', '${U3}', 'admin', '${U1}')`);
check('admins cannot demote owners', await fails(() => db.query(`select update_org_member('${o1}', '${U1}', 'viewer', '${U3}')`)));
check('admins cannot make owners', await fails(() => db.query(`select update_org_member('${o1}', '${U3}', 'owner', '${U3}')`)));
check('the last owner cannot leave', await fails(() => db.query(`select update_org_member('${o1}', '${U1}', null, '${U1}')`)));
check('the last owner cannot be demoted', await fails(() => db.query(`select update_org_member('${o1}', '${U1}', 'admin', '${U1}')`)));
await db.query(`select update_org_member('${o1}', '${U3}', null, '${U1}')`);
check('removed members lose access', (await as(U3, `select * from brands where org_id='${o1}'`)).rows.length === 0);
const inv2 = (await db.query(`select create_org_invitation('${o1}', 'stranger@example.com', 'viewer', '${H('e')}', '${U1}') as id`)).rows[0].id;
await db.query(`select revoke_org_invitation('${inv2}', '${U1}')`);
check('revoked invitations cannot be accepted', await fails(() => db.query(`select accept_org_invitation('${H('e')}', '${U4}')`)));
check('invitation preview reports status', (await db.query(`select status from invitation_preview('${H('e')}')`)).rows[0]?.status === 'revoked');

// --- Analytics (migration 11) ---
const tracked = (await db.query(`select m.*, j.idempotency_key from post_metrics m join publish_jobs j on j.id = m.job_id`)).rows;
check('published jobs are tracked for metrics', tracked.some((r) => r.idempotency_key === 'k2' && r.post_type === 'text' && r.next_collect_at));
check('members can read their metrics', (await as(U1, `select * from post_metrics`)).rows.length === tracked.length);
check('other orgs cannot read metrics', (await as(U2, `select * from post_metrics`)).rows.length === 0);
// No write policy: an update from a user silently matches no rows.
await as(U1, `update post_metrics set views = 1000000`).catch(() => {});
check('users cannot write metrics', (await db.query(`select count(*)::int as n from post_metrics where views = 1000000`)).rows[0].n === 0);
await db.exec(`update social_accounts set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000000001'`);
const k2 = tracked.find((r) => r.idempotency_key === 'k2');
const claimedMetrics = (await db.query(`select * from claim_due_metrics(now() + interval '2 hours', 10)`)).rows;
check('due metrics are claimed with the post id', claimedMetrics.some((r) => r.job_id === k2.job_id && r.external_post_id === 'x'));
check('claimed metrics are not claimed twice', (await db.query(`select * from claim_due_metrics(now() + interval '2 hours', 10)`)).rows.length === 0);
await db.query(`select record_post_metrics('${k2.job_id}', '{"views": 500, "likes": 10, "comments": 2, "shares": null, "saves": 1, "clicks": null}', now(), null, null)`);
const rec = (await db.query(`select views, shares, engagements, collect_count, next_collect_at from post_metrics where job_id = '${k2.job_id}'`)).rows[0];
check('recorded metrics keep nulls and add up engagements', Number(rec.views) === 500 && rec.shares === null && Number(rec.engagements) === 13 && rec.collect_count === 1 && rec.next_collect_at === null);
check('users cannot claim metrics', await fails(() => as(U1, `select * from claim_due_metrics(now(), 10)`)));

// --- Approvals (migration 12) ---
const U5 = '55555555-5555-5555-5555-555555555555'; // manager
const U6 = '66666666-6666-6666-6666-666666666666'; // reviewer
await db.exec(`insert into auth.users values ('${U5}', 'manager@example.com'), ('${U6}', 'reviewer@example.com');
               insert into org_members (org_id, user_id, role) values ('${o1}', '${U5}', 'manager'), ('${o1}', '${U6}', 'reviewer');
               update brands set require_approval = true where id = '${b1}'`);
const ap = (await as(U5, `insert into posts (org_id, brand_id, title) values ('${o1}', '${b1}', 'Needs approval') returning id`)).rows[0].id;
const apVariant = (await as(U5, `insert into post_variants (org_id, brand_id, post_id, social_account_id, platform, post_type, caption)
   values ('${o1}', '${b1}', '${ap}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', 'text', 'Draft copy') returning id`)).rows[0].id;
check('reviewers cannot submit posts', await fails(() => db.query(`select submit_post_for_approval('${ap}', now() + interval '1 day', '${U6}')`)));
await db.query(`select submit_post_for_approval('${ap}', now() + interval '1 day', '${U5}')`);
check('submitted post waits for approval', (await db.query(`select status from posts where id='${ap}'`)).rows[0].status === 'pending_approval');
await as(U5, `update post_variants set caption = 'sneaky edit' where id = '${apVariant}'`).catch(() => {});
check('waiting posts cannot be edited', (await db.query(`select caption from post_variants where id='${apVariant}'`)).rows[0].caption === 'Draft copy');
check('managers cannot approve', await fails(() => db.query(`select approve_post('${ap}', '${U5}', null)`)));
check('users cannot call approve directly', await fails(() => as(U6, `select approve_post('${ap}', '${U6}', null)`)));
check('rejection needs a note', await fails(() => db.query(`select reject_post('${ap}', '${U6}', '  ')`)));
await db.query(`select reject_post('${ap}', '${U6}', 'Add the launch date')`);
const rejected = (await db.query(`select status, review_note from posts where id='${ap}'`)).rows[0];
check('rejected post returns to draft with the note', rejected.status === 'draft' && rejected.review_note === 'Add the launch date');
await as(U5, `update post_variants set caption = 'Launching 1 Oct' where id = '${apVariant}'`);
check('drafts are editable again', (await db.query(`select caption from post_variants where id='${apVariant}'`)).rows[0].caption === 'Launching 1 Oct');
await db.query(`select submit_post_for_approval('${ap}', now() - interval '1 hour', '${U5}')`);
const at = (await db.query(`select approve_post('${ap}', '${U6}', 'Looks good') as at`)).rows[0].at;
const approved = (await db.query(`select p.status, (select count(*)::int from publish_jobs j where j.post_id = p.id) as jobs from posts p where p.id='${ap}'`)).rows[0];
check('approval schedules the post (now, when the requested time passed)', approved.status === 'scheduled' && approved.jobs === 1 && Math.abs(new Date(at) - Date.now()) < 60_000);
check('review history is recorded', (await db.query(`select string_agg(action, ',' order by id) as a from post_reviews where post_id='${ap}'`)).rows[0].a === 'submitted,rejected,submitted,approved');
check('other orgs cannot see reviews', (await as(U2, `select * from post_reviews`)).rows.length === 0);
check('approving twice fails', await fails(() => db.query(`select approve_post('${ap}', '${U6}', null)`)));

// --- Inbox (migration 13) ---
const syncRows = (await db.query(`select * from inbox_sync`)).rows;
check('published posts are queued for comment sync', syncRows.some((r) => r.job_id === k2.job_id));
const inboxClaim = (await db.query(`select * from claim_due_inbox(now() + interval '1 hour', 10)`)).rows;
check('due comment syncs are claimed with post details', inboxClaim.some((r) => r.job_id === k2.job_id && r.external_post_id === 'x' && r.post_type === 'text'));
check('claimed syncs are leased', (await db.query(`select * from claim_due_inbox(now() + interval '1 hour', 10)`)).rows.length === 0);
await db.exec(`insert into inbox_comments (org_id, brand_id, social_account_id, job_id, platform, external_id, author_name, text, commented_at)
               values ('${o1}', '${b1}', 'aaaaaaaa-0000-0000-0000-000000000001', '${k2.job_id}', 'linkedin', 'c1', 'Ann', 'Price?', now())`);
check('duplicate comments are rejected', await fails(() => db.exec(`insert into inbox_comments (org_id, brand_id, social_account_id, platform, external_id, commented_at)
               values ('${o1}', '${b1}', 'aaaaaaaa-0000-0000-0000-000000000001', 'linkedin', 'c1', now())`)));
check('members read their inbox', (await as(U1, `select * from inbox_comments`)).rows.length === 1);
check('other orgs cannot read the inbox', (await as(U2, `select * from inbox_comments`)).rows.length === 0);
await as(U1, `update inbox_comments set status = 'done'`).catch(() => {});
check('users cannot change comments directly', (await db.query(`select status from inbox_comments where external_id = 'c1'`)).rows[0].status === 'open');
check('users cannot claim syncs', await fails(() => as(U1, `select * from claim_due_inbox(now(), 10)`)));

// --- Launch readiness (migration 14) ---
check('heartbeats are server-only', (await as(U1, `select * from system_heartbeats`)).rows.length === 0);
check('users cannot delete organizations directly', await fails(() => as(U1, `select delete_organization('${o1}', '${U1}')`)));
check('non-owners cannot delete the organization', await fails(() => db.query(`select delete_organization('${o1}', '${U6}')`)));
check('sole owners are detected', (await db.query(`select * from sole_owned_orgs('${U1}')`)).rows.some((r) => r.org_id === o1));
const secretsBefore = (await db.query(`select count(*)::int as n from vault.secrets`)).rows[0].n;
const orgSecrets = (await db.query(`select count(*)::int as n from social_accounts where org_id = '${o1}' and token_ref is not null`)).rows[0].n;
await db.query(`select delete_organization('${o1}', '${U1}')`);
const left = (await db.query(`select (select count(*) from organizations where id = '${o1}')::int + (select count(*) from posts where org_id = '${o1}')::int
   + (select count(*) from social_accounts where org_id = '${o1}')::int + (select count(*) from publish_jobs where org_id = '${o1}')::int
   + (select count(*) from inbox_comments where org_id = '${o1}')::int + (select count(*) from org_members where org_id = '${o1}')::int as n`)).rows[0].n;
check('deleting an org leaves nothing behind', left === 0);
check('deleting an org deletes its stored tokens', (await db.query(`select count(*)::int as n from vault.secrets`)).rows[0].n === secretsBefore - orgSecrets);
check('other orgs are untouched', (await db.query(`select count(*)::int as n from organizations where id = '${o2}'`)).rows[0].n === 1);
const inviteHash = (i) => i.toString(16).padStart(64, 'f');
let limited = false;
for (let i = 0; i < 31 && !limited; i++) {
  try { await db.query(`select create_org_invitation('${o2}', 'p${i}@example.com', 'viewer', '${inviteHash(i)}', '${U2}')`); } catch { limited = true; }
}
check('invitations are rate limited', limited);
const pU2 = (await as(U2, `insert into posts (org_id, brand_id, title) values ('${o2}', '${b2}', 'by U2') returning id`)).rows[0].id;
await db.exec(`insert into auth.users values ('77777777-7777-7777-7777-777777777777', 'gone@example.com');
               insert into org_members (org_id, user_id, role) values ('${o2}', '77777777-7777-7777-7777-777777777777', 'manager');
               update posts set created_by = '77777777-7777-7777-7777-777777777777' where id = '${pU2}'`);
await db.exec(`delete from auth.users where id = '77777777-7777-7777-7777-777777777777'`);
const kept = (await db.query(`select created_by from posts where id = '${pU2}'`)).rows[0];
check('deleting a user keeps their posts', kept && kept.created_by === null);
check('deleting a user removes their memberships', (await db.query(`select count(*)::int as n from org_members where user_id = '77777777-7777-7777-7777-777777777777'`)).rows[0].n === 0);

// --- Tracked links (migration 15) ---
const keys = (await db.query(`select tracking_key from brands`)).rows.map((r) => r.tracking_key);
check('every brand gets its own tracking key', keys.length > 1 && new Set(keys).size === keys.length);
const link = (await db.query(`insert into tracked_links (org_id, brand_id, platform, code, destination, target_url)
  values ('${o2}', '${b2}', 'linkedin', 'Abc1234', 'https://acme.com', 'https://acme.com/?utm_source=linkedin') returning id`)).rows[0].id;
check('link codes must be safe', await fails(() => db.exec(`insert into tracked_links (org_id, brand_id, platform, code, destination, target_url)
  values ('${o2}', '${b2}', 'x', '../x', 'https://a.co', 'https://a.co')`)));
check('destinations must be web links', await fails(() => db.exec(`insert into tracked_links (org_id, brand_id, platform, code, destination, target_url)
  values ('${o2}', '${b2}', 'x', 'Zzz9999', 'javascript:alert(1)', 'javascript:alert(1)')`)));
const click = (await db.query(`select * from record_link_click('Abc1234', 'h1', 'IN', 'linkedin.com', false)`)).rows[0];
const botClick = (await db.query(`select * from record_link_click('Abc1234', 'h2', null, null, true)`)).rows[0];
check('clicks redirect and are counted, bots are not', click.target_url.includes('utm_source') && !!click.click_id && botClick.click_id === null
  && (await db.query(`select clicks from tracked_links where id = '${link}'`)).rows[0].clicks === 1);
check('unknown codes return nothing', (await db.query(`select * from record_link_click('Nope000', 'h', null, null, false)`)).rows.length === 0);
check('conversions attach to the click and link', (await db.query(`select record_conversion('${b2}', '${click.click_id}', 'signup', 49, 'USD', 'order-1', 'server') as ok`)).rows[0].ok === true
  && (await db.query(`select link_id from conversions where external_id = 'order-1'`)).rows[0].link_id === link);
check('repeated conversions are ignored', (await db.query(`select record_conversion('${b2}', '${click.click_id}', 'signup', 49, 'USD', 'order-1', 'server') as ok`)).rows[0].ok === false);
const otherBrand = (await db.query(`select id from brands where id <> '${b2}' limit 1`)).rows[0]?.id;
check('clicks from another brand are refused', !otherBrand || (await db.query(`select record_conversion('${otherBrand}', '${click.click_id}', 'signup', null, null, null, 'snippet') as ok`)).rows[0].ok === false);
check('members read their clicks', (await as(U2, `select * from link_clicks`)).rows.length === 1);
check('others cannot', (await as(U5, `select * from link_clicks`)).rows.length === 0);
check('users cannot record clicks directly', await fails(() => as(U2, `select * from record_link_click('Abc1234', 'h', null, null, false)`)));
