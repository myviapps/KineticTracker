-- first_snapshot_per_platform — the earliest snapshot date per platform, aggregated
-- in the database instead of in the application.
--
-- Re-runnable: `create or replace`.
--
-- ── Why this exists ────────────────────────────────────────────────────────
-- performance.functions.ts needs one date per platform: when did we start
-- collecting? It was getting that by SELECTing every daily_snapshots row for
-- every student, across all time and with no date filter, then keeping the
-- first date it saw per platform while scanning in JS.
--
-- That is O(all history) to produce O(platforms) rows, and it was wrong as well
-- as wasteful: PostgREST caps an unbounded select, so once a cohort's history
-- passed the ceiling the rows for a later-onboarded platform fell off the end.
-- The platform then had no entry in the map, came back as
-- `first_snapshot_date: null`, and the overview's week/month cards rendered
-- "no history yet" for a platform that had been collecting for weeks — while
-- the trend chart, reading a different source, happily showed a fortnight of
-- data for the same cohort.
--
-- Raising the row cap only postpones that. An aggregate removes the class of
-- bug: the result is a handful of rows no matter how much history accumulates.
--
-- ── Note on the index ──────────────────────────────────────────────────────
-- daily_snapshots only had an index on snapshot_date alone. The grouping below
-- is per platform, so this adds the composite that lets Postgres reach the
-- minimum per group without scanning the table.

create index if not exists daily_snapshots_platform_date_idx
  on public.daily_snapshots (platform_id, snapshot_date);

create or replace function public.first_snapshot_per_platform(
  p_student_ids uuid[]
)
returns table (
  platform_id text,
  first_date  date
)
language sql
stable
security definer
set search_path = public
as $$
  select s.platform_id, min(s.snapshot_date)
  from public.daily_snapshots s
  where s.student_id = any(p_student_ids)
  group by s.platform_id;
$$;

-- Called by a server function that has already done its own access check on the
-- student ids it passes; the definer rights exist to reach daily_snapshots, not
-- to widen who may ask.
grant execute on function public.first_snapshot_per_platform(uuid[]) to authenticated, service_role;
