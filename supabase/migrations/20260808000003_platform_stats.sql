-- Migration: per-platform stats, plus a platform dimension on the history tables.
--
-- Re-runnable: `if not exists` / `or replace` / guarded DO blocks throughout.
--
-- PHASE 1 of 2, ADDITIVE. student_stats is NOT touched — it stays the live
-- LeetCode store that ~33 call sites read and that scrape.server.ts writes.
-- platform_stats is seeded from it as a point-in-time copy. Phase 2 swaps
-- student_stats to a VIEW over this table in the same deploy as the adapter-based
-- worker, which is what keeps those 33 readers working without being rewritten.
--
-- ── Why hybrid (typed columns + a data jsonb) ───────────────────────────────
-- Typed columns exist for exactly the fields we RANK, SORT or CHART on, because
-- those have to work in plain SQL: the composite score and every leaderboard are
-- window functions over this table, and `(data->>'total_solved')::int` in a
-- window function over 340 students × N platforms is both slower and far easier
-- to get subtly wrong.
--
-- Everything else — submission calendars, per-track scores, contest histories,
-- badges, language and tag breakdowns — lives in `data`. Those are read one
-- student at a time to draw a panel, never aggregated across students, so they
-- gain nothing from being columns and would otherwise add ~40 mostly-null ones.
-- The practical payoff: a platform exposing a new field is an adapter change, not
-- a migration.
--
-- No platform provides all of these. Verified availability:
--   total_solved     LeetCode, Codeforces (derived), AtCoder, GFG, HackerRank (summed), CodeChef
--   easy/medium/hard LeetCode, Codeforces (via cached problemset ratings), GFG
--   rating/max       Codeforces, CodeChef, AtCoder, LeetCode (contest only)
--   global_rank      LeetCode, AtCoder, CodeChef
--   country_rank     CodeChef
--   institute_rank   GeeksforGeeks
--   platform_score   GFG (coding score), HackerRank (elo), SPOJ (points)
--   stars            HackerRank, CodeChef

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Latest stats — one row per (student, platform)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.platform_stats (
  account_id        uuid primary key
                      references public.student_platform_accounts(id) on delete cascade,
  -- Denormalised so ranking never has to join through the accounts table. The
  -- unique constraint below keeps it honest.
  student_id        uuid not null references public.students(id)  on delete cascade,
  platform_id       text not null references public.platforms(id) on delete cascade,

  -- ── identity, as the platform reports it ──────────────────────────────────
  display_name      text,
  avatar            text,
  country           text,

  -- ── the ranked / charted set ──────────────────────────────────────────────
  total_solved      int,
  easy_solved       int,
  medium_solved     int,
  hard_solved       int,
  -- Platforms with no difficulty split (HackerRank, CodeChef, AtCoder) put their
  -- whole count here, so the composite can weight it separately rather than
  -- pretending every unclassified problem is "easy".
  unrated_solved    int,
  rating            numeric,
  max_rating        numeric,
  global_rank       bigint,
  country_rank      bigint,
  institute_rank    bigint,
  platform_score    numeric,
  stars             int,
  streak            int,
  contests_attended int,

  -- ── everything else, verbatim from the adapter ────────────────────────────
  data              jsonb not null default '{}',

  -- 'partial' is its own state on purpose: LeetCode's calendar and recent-
  -- submission calls are best-effort and get skipped when a chunk runs out of
  -- budget. That is a complete row with optional extras missing, not a failure,
  -- and the health page should not show it as one.
  fetch_status      text not null default 'success'
                      check (fetch_status in ('success', 'partial', 'failed')),
  error_msg         text,
  fetched_at        timestamptz not null default now(),

  unique (student_id, platform_id)
);

create index if not exists platform_stats_platform_idx
  on public.platform_stats (platform_id);
-- Serves the per-platform leaderboards and the rank window functions.
create index if not exists platform_stats_rank_idx
  on public.platform_stats (platform_id, total_solved desc nulls last);
create index if not exists platform_stats_rating_idx
  on public.platform_stats (platform_id, rating desc nulls last);

comment on table public.platform_stats is
  'Latest stats per (student, platform). Typed columns are the ranked/charted set; everything platform-specific lives in data.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Backfill from student_stats (LeetCode only — it is all that exists today)
-- ════════════════════════════════════════════════════════════════════════════

insert into public.platform_stats (
  account_id, student_id, platform_id,
  display_name, avatar, country,
  total_solved, easy_solved, medium_solved, hard_solved,
  rating, global_rank, streak, contests_attended,
  data, fetch_status, fetched_at
)
select
  a.id, ss.student_id, 'leetcode',
  ss.real_name, ss.avatar, ss.country,
  ss.total_solved, ss.easy_solved, ss.medium_solved, ss.hard_solved,
  ss.contest_rating, ss.ranking, ss.streak, ss.contests_attended,
  -- strip_nulls keeps the blob small; a missing key and a null one mean the same
  -- thing to every reader.
  jsonb_strip_nulls(jsonb_build_object(
    'reputation',             ss.reputation,
    'total_questions',        ss.total_questions,
    'easy_total',             ss.easy_total,
    'medium_total',           ss.medium_total,
    'hard_total',             ss.hard_total,
    'acceptance_rate',        ss.acceptance_rate,
    'total_active_days',      ss.total_active_days,
    'contest_global_ranking', ss.contest_global_ranking,
    'contest_top_percentage', ss.contest_top_percentage,
    'submission_calendar',    ss.submission_calendar,
    'language_stats',         ss.language_stats,
    'tag_stats',              ss.tag_stats,
    'badges',                 ss.badges
  )),
  'success',
  coalesce(ss.updated_at, now())
from public.student_stats ss
join public.student_platform_accounts a
  on a.student_id = ss.student_id
 and a.platform_id = 'leetcode'
on conflict (account_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. History tables gain a platform dimension
-- ════════════════════════════════════════════════════════════════════════════
--
-- daily_snapshots is EXTENDED rather than replaced by a separate event-log table:
-- the "Solved Over Time" chart and the daily matrix both depend on its
-- daily-rollup shape (one row per student per day, with solved_that_day already
-- differenced). Existing rows default to 'leetcode', which is what they are.

alter table public.daily_snapshots
  add column if not exists platform_id     text    not null default 'leetcode'
                                                   references public.platforms(id),
  add column if not exists unrated_solved  int,
  add column if not exists rating          numeric,
  add column if not exists platform_score  numeric;

-- Swap the PK to include the platform. Looked up by catalog rather than by name
-- so this does not depend on the constraint being called daily_snapshots_pkey,
-- and it is skipped entirely once already applied.
do $$
declare v_pk text;
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.daily_snapshots'::regclass
       and contype  = 'p'
       and pg_get_constraintdef(oid) like '%platform_id%'
  ) then
    select conname into v_pk
      from pg_constraint
     where conrelid = 'public.daily_snapshots'::regclass and contype = 'p';

    if v_pk is not null then
      execute format('alter table public.daily_snapshots drop constraint %I', v_pk);
    end if;

    alter table public.daily_snapshots
      add constraint daily_snapshots_pkey
      primary key (student_id, platform_id, snapshot_date);
  end if;
end $$;

alter table public.recent_submissions
  add column if not exists platform_id text not null default 'leetcode'
                                            references public.platforms(id);

create index if not exists recent_submissions_student_platform_idx
  on public.recent_submissions (student_id, platform_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Same delegation as student_platform_accounts: has_student_access() is the one
-- authority, so SQL and authz.ts cannot drift. Writes are service-role only.

alter table public.platform_stats enable row level security;

drop policy if exists "platform_stats authenticated select" on public.platform_stats;
create policy "platform_stats authenticated select"
  on public.platform_stats for select
  to authenticated
  using (public.has_student_access(auth.uid(), student_id));

grant select on public.platform_stats to authenticated;
