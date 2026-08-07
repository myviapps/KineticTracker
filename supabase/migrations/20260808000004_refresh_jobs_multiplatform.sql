-- Migration: give refresh_jobs a platform dimension and an account cursor.
--
-- Re-runnable: `add column if not exists` / `create index if not exists`.
--
-- PHASE 1 of 2, and deliberately COLUMNS ONLY. enqueue_refresh_job,
-- claim_refresh_job, commit_refresh_batch and release_refresh_job are left
-- exactly as they are, so the running worker — which still pages students and
-- writes cursor_student_id — is completely unaffected. Every column added here
-- is nullable or defaulted.
--
-- Phase 2 replaces those four RPCs together with the adapter-based worker, in one
-- deploy. Two things change then, and both are called out below because they are
-- the parts that are easy to get wrong.

alter table public.refresh_jobs
  -- null = every enabled platform. A per-platform job is the normal case; the
  -- null case exists for "refresh everything" from the admin UI.
  add column if not exists platform_id text references public.platforms(id),

  -- Replaces cursor_student_id once the unit of work becomes an ACCOUNT rather
  -- than a student. Both exist during the transition: an in-flight job written by
  -- the old worker keeps its student cursor and finishes on it, so a deploy
  -- mid-run does not strand a job.
  add column if not exists cursor_account_id uuid
    references public.student_platform_accounts(id) on delete set null,

  -- Carries the measured batch duration ACROSS chunks. The worker already
  -- measures it within a chunk and admits batches off the measurement rather than
  -- the old hardcoded 12s guess, but each chunk currently starts cold and has to
  -- re-learn on its first batch. Seeding from the last chunk means a slow platform
  -- is throttled correctly from batch one instead of batch two.
  add column if not exists est_batch_ms int not null default 12000;

create index if not exists refresh_jobs_platform_idx
  on public.refresh_jobs (platform_id, status);

comment on column public.refresh_jobs.platform_id is
  'Which platform this job refreshes. NULL = all enabled platforms.';
comment on column public.refresh_jobs.cursor_account_id is
  'Keyset cursor into student_platform_accounts. Supersedes cursor_student_id in Phase 2.';

-- ════════════════════════════════════════════════════════════════════════════
-- What Phase 2 has to change, and why it is not being done here
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. SINGLE-FLIGHT MUST BECOME PER-PLATFORM.
--    Two things enforce "one job at a time" today, and BOTH are global:
--      a) the refresh_jobs_single_flight unique index, on
--         (lock_key) where status in ('queued','running') — lock_key is always
--         'global';
--      b) enqueue_refresh_job's own guard,
--         `select id from refresh_jobs where status in ('queued','running')`,
--         which ignores lock_key entirely and raises refresh_already_active.
--    Changing only the index would leave (b) still serialising everything, which
--    is exactly the sort of half-migration that looks fine until a second
--    platform is switched on. Phase 2 sets lock_key = 'platform:' || platform_id
--    at enqueue and scopes both checks to it.
--
--    This matters concretely: CodeChef and HackerRank sit behind Cloudflare and
--    will trip the circuit breaker, which parks a job for 15 minutes. Under a
--    global lock that parks Codeforces and LeetCode too — one blocked scraper
--    stops all ingestion.
--
-- 2. THE WORKER'S PAGING QUERY MOVES TO ACCOUNTS.
--    It currently pages `students` (or classroom_students) by id. Phase 2 pages
--    student_platform_accounts by (platform_id, id), which is what
--    student_platform_accounts_scan_idx was built for, filtered on
--    status <> 'invalid_handle' and on platforms.refresh_ttl_hours so accounts
--    fetched recently are skipped rather than re-requested.
