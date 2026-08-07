-- Migration: one row per (student, platform) handle.
--
-- Re-runnable: `if not exists` / `or replace` / `on conflict do nothing` throughout.
--
-- PHASE 1 of 2, ADDITIVE. students.leetcode_id is deliberately LEFT IN PLACE and
-- keeps its NOT NULL and UNIQUE. It is still the source of truth for the running
-- LeetCode pipeline; this table is a synchronised copy until the adapter-based
-- worker ships. A trigger keeps the two consistent, so the currently-deployed app
-- goes on working against this schema and a rollback is a `git revert`.
--
-- Phase 2 retires students.leetcode_id to leetcode_id_legacy — exactly how
-- classroom_id was handled in 20260731000001 → 20260807000001 — and only after
-- every reader has moved over.
--
-- This is the table that makes the unit of work a (student, platform) PAIR rather
-- than a student. That matters more than it looks: it is what lets one blocked
-- platform be paused without stalling the others, and what keeps a chunk's
-- workload predictable when a student is on six platforms instead of one.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Pre-flight
-- ════════════════════════════════════════════════════════════════════════════
--
-- handle_normalized is UNIQUE per platform and lower-cases, while
-- students.leetcode_id's UNIQUE is case-SENSITIVE. So "Foo" and "foo" satisfy the
-- old constraint but collide under the new one. REPORTED, not fatal: the backfill
-- below keeps the most recently scraped row of any such pair and skips the rest,
-- and the pair still surfaces under Scrape History -> Duplicates.
do $$
declare v_n int; v_report text;
begin
  select count(*), string_agg(lh, ', ' order by lh) into v_n, v_report
  from (
    select lower(trim(leetcode_id)) as lh
    from public.students
    where leetcode_id is not null and trim(leetcode_id) <> ''
    group by lower(trim(leetcode_id))
    having count(*) > 1
    limit 50
  ) d;

  if coalesce(v_n, 0) > 0 then
    raise warning
      'ACTION REQUIRED: % LeetCode handle(s) differ only by letter case and share one account row: %. The most recently scraped student keeps the handle; the others were skipped and will not be refreshed. Resolve them under Scrape History -> Duplicates.',
      v_n, v_report;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Table
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.student_platform_accounts (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references public.students(id)  on delete cascade,
  platform_id           text not null references public.platforms(id) on delete cascade,

  handle                text not null,
  -- Generated, not app-maintained: uniqueness must not depend on every call site
  -- remembering to lower-case first.
  handle_normalized     text generated always as (lower(trim(handle))) stored,

  -- 'unverified'    — entered but never successfully fetched
  -- 'active'        — last fetch succeeded
  -- 'invalid_handle'— the platform says no such user; stop spending requests
  -- 'blocked'       — the platform refused US (Cloudflare), not the handle's fault
  status                text not null default 'unverified'
                          check (status in ('unverified', 'active', 'invalid_handle', 'blocked')),
  verified_at           timestamptz,

  last_fetched_at       timestamptz,
  fetch_error           text,
  consecutive_failures  int not null default 0,

  -- Incremental-fetch state, shape owned by each adapter. Codeforces needs it
  -- most: total_solved has to be derived from the full submission history
  -- (~1.3MB for a heavy user), so the adapter stores the newest submission id it
  -- has seen and asks only for what is above it on the next run. Cheap to add
  -- now, painful to retrofit once there is history to migrate.
  sync_cursor           jsonb not null default '{}',

  created_at            timestamptz not null default now(),

  unique (student_id, platform_id),
  unique (platform_id, handle_normalized)
);

-- Serves the worker's keyset scan as ONE index range scan: the worker pages
-- `where platform_id = $1 and id > $cursor order by id`, and permanently broken
-- handles are excluded from the index entirely rather than filtered per row.
create index if not exists student_platform_accounts_scan_idx
  on public.student_platform_accounts (platform_id, id)
  where status <> 'invalid_handle';

create index if not exists student_platform_accounts_student_idx
  on public.student_platform_accounts (student_id);

comment on table public.student_platform_accounts is
  'One handle per (student, platform). The unit of work for the refresh worker.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Backfill from students.leetcode_id
-- ════════════════════════════════════════════════════════════════════════════
--
-- distinct on (lower(trim(...))) resolves the case-collisions warned about above
-- by keeping the most recently scraped row. Failure state carries across so the
-- new worker inherits the old one's knowledge of which handles are broken instead
-- of re-discovering it one wasted request at a time.

insert into public.student_platform_accounts
  (student_id, platform_id, handle, status, last_fetched_at, fetch_error, consecutive_failures, verified_at)
select distinct on (lower(trim(s.leetcode_id)))
  s.id,
  'leetcode',
  s.leetcode_id,
  case
    -- Mirrors FAILURE_CUTOFF (5) in scrape-runs.functions.ts: the worker already
    -- refuses to spend requests on these, so they start parked rather than
    -- burning five more failures to reach the same conclusion.
    when coalesce(s.consecutive_failures, 0) >= 5      then 'invalid_handle'
    when s.last_scraped_at is not null
         and s.scrape_error is null                    then 'active'
    else                                                    'unverified'
  end,
  s.last_scraped_at,
  s.scrape_error,
  coalesce(s.consecutive_failures, 0),
  case when s.last_scraped_at is not null and s.scrape_error is null
       then s.last_scraped_at end
from public.students s
where s.leetcode_id is not null
  and trim(s.leetcode_id) <> ''
order by
  lower(trim(s.leetcode_id)),
  -- Prefer a handle that actually WORKS over one that merely scraped more
  -- recently. Recency alone would hand the account to whichever twin failed
  -- last night and discard the one with real stats behind it.
  (s.scrape_error is null and coalesce(s.consecutive_failures, 0) = 0) desc,
  s.last_scraped_at desc nulls last,
  s.id
on conflict (student_id, platform_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Keep the copy honest while both exist
-- ════════════════════════════════════════════════════════════════════════════
--
-- Through Phase 1 the app still writes students.leetcode_id (add student, bulk
-- import, duplicate merge). Without this the account row silently goes stale and
-- the new worker would refresh a handle the UI no longer shows.
--
-- Case-collisions raise a WARNING and skip rather than aborting: a student edit
-- failing with a constraint error from a table the user has never heard of is a
-- worse outcome than one un-synced row that the pre-flight check already reports.

create or replace function public.sync_leetcode_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_handle text;
begin
  if new.leetcode_id is null or trim(new.leetcode_id) = '' then
    delete from public.student_platform_accounts
     where student_id = new.id and platform_id = 'leetcode';
    return new;
  end if;

  -- Read-then-branch rather than INSERT ... ON CONFLICT DO UPDATE: inside a DO
  -- UPDATE clause the target row can only be referenced by the table's bare
  -- name, never schema-qualified, and getting that wrong fails at runtime on a
  -- student edit rather than here at migration time. The explicit form is also
  -- simply easier to read.
  select handle into v_old_handle
    from public.student_platform_accounts
   where student_id = new.id and platform_id = 'leetcode';

  if v_old_handle is null then
    insert into public.student_platform_accounts (student_id, platform_id, handle, status)
    values (new.id, 'leetcode', new.leetcode_id, 'unverified');

  elsif lower(trim(v_old_handle)) is distinct from lower(trim(new.leetcode_id)) then
    -- A changed handle invalidates everything we knew about the old one: the
    -- failure count, the last error and the verification all belonged to a
    -- different person's profile.
    update public.student_platform_accounts
       set handle               = new.leetcode_id,
           status               = 'unverified',
           consecutive_failures = 0,
           fetch_error          = null,
           verified_at          = null
     where student_id = new.id and platform_id = 'leetcode';
  end if;

  return new;
exception
  when unique_violation then
    raise warning
      'student_platform_accounts: LeetCode handle "%" is already claimed by another student (case-insensitive). Student % was not synced.',
      new.leetcode_id, new.id;
    return new;
end $$;

drop trigger if exists students_sync_leetcode_account on public.students;
create trigger students_sync_leetcode_account
  after insert or update of leetcode_id on public.students
  for each row execute function public.sync_leetcode_account();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- A handle is identifying, so this follows students' own rule exactly:
-- authenticated access is delegated to has_student_access() rather than
-- re-implemented, so the SQL and the TypeScript in authz.ts cannot drift.
-- Anonymous visitors get nothing here — the public student page is served by a
-- service-role server function that masks handles in TypeScript (see mask.ts).

alter table public.student_platform_accounts enable row level security;

drop policy if exists "accounts authenticated select" on public.student_platform_accounts;
create policy "accounts authenticated select"
  on public.student_platform_accounts for select
  to authenticated
  using (public.has_student_access(auth.uid(), student_id));

grant select on public.student_platform_accounts to authenticated;
