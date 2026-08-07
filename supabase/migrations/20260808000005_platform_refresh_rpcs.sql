-- Migration: the account-based refresh RPCs.
--
-- Re-runnable: `create or replace` throughout.
--
-- ADDITIVE BY NAMING. enqueue_refresh_job, claim_refresh_job,
-- commit_refresh_batch and release_refresh_job are NOT modified — the running
-- LeetCode worker keeps using them untouched. The account-based path gets new
-- names alongside.
--
-- Adding parameters to the existing functions instead would have created
-- overloads that Postgres resolves ambiguously when defaults overlap, and would
-- have made rollback a database change rather than a `git revert`. The old three
-- get dropped once nothing calls them.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. platform_account_page — the worker's keyset scan
-- ════════════════════════════════════════════════════════════════════════════
--
-- An RPC rather than a PostgREST query for the same reason classroom_student_page
-- is one: filtering an embedded resource combined with a limit has surprising
-- semantics, and the worker treats "0 rows" as *queue drained*. Getting that
-- wrong silently marks a job complete.
--
-- Ordering by id (not by staleness) is what makes the cursor stable: a row whose
-- last_fetched_at changes mid-run must not jump position and cause a student to
-- be skipped or scanned twice.

create or replace function public.platform_account_page(
  p_platform_id  text,
  p_cursor       uuid        default null,
  p_limit        int         default 5,
  p_max_failures int         default 5,
  p_scope        text        default 'platform',
  p_classroom_id uuid        default null,
  p_student_ids  uuid[]      default null,
  p_stale_before timestamptz default null
)
returns table (
  account_id  uuid,
  student_id  uuid,
  handle      text,
  sync_cursor jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.student_id, a.handle, a.sync_cursor
  from public.student_platform_accounts a
  where a.platform_id = p_platform_id
    -- Permanently broken handles are excluded by the partial index, so this
    -- predicate is served by student_platform_accounts_scan_idx rather than
    -- costing a filter per row.
    and a.status <> 'invalid_handle'
    and a.consecutive_failures < p_max_failures
    and a.id > coalesce(p_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      p_scope = 'platform'
      or (p_scope = 'classroom' and exists (
            select 1 from public.classroom_students cs
            where cs.student_id = a.student_id
              and cs.classroom_id = p_classroom_id))
      or (p_scope = 'students' and a.student_id = any(p_student_ids))
    )
    -- TTL: the cheapest defence against a rate limit is not making the request.
    and (p_stale_before is null
         or a.last_fetched_at is null
         or a.last_fetched_at < p_stale_before)
  order by a.id
  limit greatest(p_limit, 1);
$$;

grant execute on function public.platform_account_page(text, uuid, int, int, text, uuid, uuid[], timestamptz)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. enqueue_platform_refresh_job — PER-PLATFORM single-flight
-- ════════════════════════════════════════════════════════════════════════════
--
-- The important change. Two things enforced "one job at a time" and both were
-- global: the refresh_jobs_single_flight unique index on lock_key (always
-- 'global'), and enqueue_refresh_job's own `status in ('queued','running')`
-- guard, which ignored lock_key entirely.
--
-- Under a global lock, CodeChef tripping its circuit breaker parks the job for
-- 15 minutes — and with it Codeforces, LeetCode and everything else. One blocked
-- scraper stops all ingestion. Scoping the lock to 'platform:<id>' is what lets
-- a fragile platform fail on its own.

create or replace function public.enqueue_platform_refresh_job(
  p_platform_id  text,
  p_scope        text        default 'platform',
  p_classroom_id uuid        default null,
  p_student_ids  uuid[]      default null,
  p_filter       text        default 'all',
  p_created_by   uuid        default null,
  p_stale_before timestamptz default null,
  p_force        boolean     default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock   text := 'platform:' || p_platform_id;
  v_total  int;
  v_active uuid;
  v_id     uuid;
begin
  if not exists (select 1 from public.platforms where id = p_platform_id) then
    raise exception 'unknown_platform: %', p_platform_id;
  end if;

  -- Reap a job whose lease expired long ago, scoped to THIS platform.
  update public.refresh_jobs
     set status = 'cancelled', finished_at = now(), lease_owner = null, lease_until = null
   where lock_key = v_lock
     and status = 'running'
     and lease_until is not null
     and lease_until < now() - interval '2 minutes';

  select id into v_active
    from public.refresh_jobs
   where lock_key = v_lock
     and status in ('queued', 'running')
   limit 1;

  if v_active is not null then
    if not p_force then
      raise exception 'refresh_already_active';
    end if;
    update public.refresh_jobs
       set status = 'cancelled', finished_at = now(), lease_owner = null, lease_until = null
     where id = v_active;
  end if;

  -- Count exactly what the worker will page, so the progress denominator is
  -- reachable. Counting all accounts while the worker skips fresh ones would
  -- leave the bar stuck short of 100% and the job never reading as complete.
  select count(*) into v_total
    from public.student_platform_accounts a
   where a.platform_id = p_platform_id
     and a.status <> 'invalid_handle'
     and a.consecutive_failures < 5
     and (
       p_scope = 'platform'
       or (p_scope = 'classroom' and exists (
             select 1 from public.classroom_students cs
             where cs.student_id = a.student_id and cs.classroom_id = p_classroom_id))
       or (p_scope = 'students' and a.student_id = any(p_student_ids))
     )
     and (p_stale_before is null
          or a.last_fetched_at is null
          or a.last_fetched_at < p_stale_before);

  insert into public.refresh_jobs (
    lock_key, platform_id, scope, classroom_id, student_ids,
    filter, stale_before, total, created_by, batch_size, cooldown_ms, est_batch_ms
  )
  select
    v_lock, p_platform_id, p_scope, p_classroom_id, p_student_ids,
    p_filter, p_stale_before, coalesce(v_total, 0), p_created_by,
    p.batch_size, p.base_cooldown_ms, p.est_batch_ms
  from public.platforms p
  where p.id = p_platform_id
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.enqueue_platform_refresh_job(text, text, uuid, uuid[], text, uuid, timestamptz, boolean)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. commit_platform_batch — atomic compare-and-swap on the ACCOUNT cursor
-- ════════════════════════════════════════════════════════════════════════════
--
-- Same contract as commit_refresh_batch: the update only lands if we still hold
-- the lease AND the cursor is where we left it. Returning false means another
-- worker moved it, and the caller must abort rather than double-count.
--
-- p_errors takes a jsonb ARRAY. Passing JSON.stringify(...) of one makes it a
-- jsonb string scalar and jsonb_array_length() then raises SQLSTATE 22023, which
-- previously stalled a job permanently on its first failing student.

create or replace function public.commit_platform_batch(
  p_job_id          uuid,
  p_owner           uuid,
  p_expected_cursor uuid,
  p_new_cursor      uuid,
  p_ok              int,
  p_failed          int,
  p_cooldown_ms     int,
  p_clean_streak    int,
  p_est_batch_ms    int     default null,
  p_errors          jsonb   default '[]',
  p_done            boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.refresh_jobs
  set
    cursor_account_id = p_new_cursor,
    processed    = processed + p_ok + p_failed,
    succeeded    = succeeded + p_ok,
    failed       = failed + p_failed,
    cooldown_ms  = p_cooldown_ms,
    clean_streak = p_clean_streak,
    -- Carried across chunks so a slow platform is paced correctly from its first
    -- batch instead of re-learning that every time a chunk starts cold.
    est_batch_ms = coalesce(p_est_batch_ms, est_batch_ms),
    errors = case
      when p_errors is not null and jsonb_array_length(p_errors) > 0
        then refresh_jobs.errors || p_errors
      else refresh_jobs.errors
    end,
    lease_until = case when p_done then lease_until else now() + interval '30 seconds' end,
    status      = case when p_done then 'completed' else 'running' end,
    finished_at = case when p_done then now() else null end,
    last_error  = case
      when p_errors is not null and jsonb_array_length(p_errors) > 0
        then (p_errors->0->>'error')::text
      else null
    end
  where id = p_job_id
    and lease_owner = p_owner
    and cursor_account_id is not distinct from p_expected_cursor;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

grant execute on function public.commit_platform_batch(uuid, uuid, uuid, uuid, int, int, int, int, int, jsonb, boolean)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. next_platform_job — what the pump should run next
-- ════════════════════════════════════════════════════════════════════════════
--
-- Encodes the eligibility rule in SQL rather than in a PostgREST filter chain.
-- The pump previously expressed it as two chained .or() groups, which PostgREST
-- ANDs together — so it demanded a job be both queued-ish AND paused-ish, and a
-- freshly queued job (resume_after NULL) never qualified. The pump answered
-- "no eligible job" for the common case for as long as it existed.
--
-- Round-robins across platforms by preferring the least recently started job, so
-- one busy platform cannot starve the others.

create or replace function public.next_platform_job()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.id
  from public.refresh_jobs j
  where (
      j.status = 'queued'
      or (j.status = 'running' and (j.lease_until is null or j.lease_until < now()))
      or (j.status = 'paused'  and j.resume_after is not null and j.resume_after <= now())
    )
  order by coalesce(j.started_at, j.created_at) asc
  limit 1;
$$;

grant execute on function public.next_platform_job() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. scrape_runs.student_id — a column the app has always tried to write
-- ════════════════════════════════════════════════════════════════════════════
--
-- refreshStudent() in students.functions.ts inserts a scrape_runs row with
-- student_id set, and scrape_runs.source already allows 'student'. The column
-- was never created, so every one of those inserts failed with 42703 (undefined
-- column) — inside an empty catch block, so it failed silently and a
-- single-student refresh has never once shown up in Scrape History.
--
-- Nullable, because platform/classroom runs legitimately have no single student.

alter table public.scrape_runs
  add column if not exists student_id uuid references public.students(id) on delete set null,
  add column if not exists platform_id text references public.platforms(id);

create index if not exists scrape_runs_student_idx
  on public.scrape_runs (student_id) where student_id is not null;
