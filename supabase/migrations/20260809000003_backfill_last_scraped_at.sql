-- Backfill students.last_scraped_at from evidence that already exists.
--
-- students.last_scraped_at was only ever written by the legacy LeetCode-only
-- worker. Once refreshes moved to per-platform jobs nothing wrote it, so the
-- column stayed NULL for every student ingested since — and the classroom
-- "N pending" badge and the admin scrape-runs page both read that column and
-- nothing else. Fully refreshed cohorts reported every student as pending.
--
-- platform_stats.fetched_at already records when each account was last read, so
-- the correct value is recoverable rather than guessable: take the most recent
-- successful fetch across all of a student's platforms.
--
-- The application-side fix (mirrorIngestionStamp in platform-stats.server.ts)
-- keeps the column current from here on. This migration exists so the badge is
-- right immediately instead of only after the next full refresh cycle.
--
-- Only touches rows where the column is NULL, so a genuine legacy timestamp is
-- never overwritten with a later platform read. Idempotent: re-running finds
-- nothing left to do.

update public.students s
set last_scraped_at = latest.fetched_at
from (
  select student_id, max(fetched_at) as fetched_at
  from public.platform_stats
  where fetched_at is not null
    and fetch_status in ('success', 'partial')
  group by student_id
) as latest
where latest.student_id = s.id
  and s.last_scraped_at is null;
