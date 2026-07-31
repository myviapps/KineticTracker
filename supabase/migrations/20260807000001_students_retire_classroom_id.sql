-- Migration: retire students.classroom_id and enforce UNIQUE(leetcode_id).
--
-- PHASE 2 of 2. Run this ONLY after 20260731000001 has soaked and every duplicate
-- LeetCode handle reported by it has been resolved under Scrape History ->
-- Duplicates. This migration is not additive: the previous app version cannot run
-- against the resulting schema.
--
-- ORDERING IS LOAD-BEARING. Step 4 (the rename) fails while a policy or a view
-- still depends on the column, so steps 2 and 3 must run first.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Pre-flight, then the second identity constraint
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare v_n int; v_report text;
begin
  -- Rolls. Two rows with one roll is the pre-migration multi-classroom workaround;
  -- by now each should be one student with several memberships.
  select count(*), string_agg(r || ' x' || n, ', ' order by n desc)
    into v_n, v_report
  from (
    select lower(trim(roll)) as r, count(*) as n
    from public.students group by lower(trim(roll)) having count(*) > 1 limit 50
  ) d;
  if coalesce(v_n, 0) > 0 then
    raise exception
      'ABORT: % roll number(s) are still used by more than one student: %. Merge them under Scrape History -> Duplicates and re-run.',
      v_n, v_report using errcode = 'unique_violation';
  end if;

  -- LeetCode handles.
  select count(*), string_agg(h || ' x' || n, ', ' order by n desc)
    into v_n, v_report
  from (
    select lower(trim(leetcode_id)) as h, count(*) as n
    from public.students group by lower(trim(leetcode_id)) having count(*) > 1 limit 50
  ) d;
  if coalesce(v_n, 0) > 0 then
    raise exception
      'ABORT: % LeetCode handle(s) are still shared by more than one student: %. Resolve them under Scrape History -> Duplicates and re-run.',
      v_n, v_report using errcode = 'unique_violation';
  end if;
end $$;

-- Case-SENSITIVE by necessity: PostgREST can only infer an `on_conflict` target
-- against an index on the bare column, so `unique (lower(leetcode_id))` is not an
-- option. The app normalizes handles to lower(trim(...)) on every write path, and
-- the pre-flight above is case-insensitive so nothing mixed-case survives to here.
alter table public.students add constraint students_roll_key unique (roll);
drop index if exists public.students_roll_idx;   -- superseded by the constraint
alter table public.students add constraint students_leetcode_id_key unique (leetcode_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Drop the overlap-week sync trigger
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists classroom_students_sync_legacy on public.classroom_students;
drop function if exists public.sync_legacy_classroom_id();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Drop everything that depends on students.classroom_id
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "students authenticated select"           on public.students;
drop policy if exists "student_stats authenticated select"      on public.student_stats;
drop policy if exists "daily_snapshots authenticated select"    on public.daily_snapshots;
drop policy if exists "recent_submissions authenticated select" on public.recent_submissions;

-- `create or replace view` cannot remove a column, so this has to be a real drop.
-- Its grants go with it and are re-issued in step 5.
drop view if exists public.students_public;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Retire the column
-- ════════════════════════════════════════════════════════════════════════════

-- The FK MUST go. If it survives, PostgREST sees TWO relationship paths from
-- students to classrooms — this FK, and the many-to-many via classroom_students —
-- and answers `select=...,classrooms(name)` with HTTP 300 "Could not embed because
-- more than one relationship was found", which is exactly the query
-- listFailedStudents runs.
alter table public.students drop constraint if exists students_classroom_id_fkey;

-- After the rename this would become UNIQUE(classroom_id_legacy, roll): with NULLs
-- in the legacy column it enforces nothing, but it is a trap for the next reader.
alter table public.students drop constraint if exists students_classroom_id_roll_key;

-- RENAMED, not dropped. PostgREST, the generated types and the app all behave
-- identically to a drop — `.eq("classroom_id", ...)` 400s either way — but the
-- pre-migration assignment stays on disk, which turns rollback from a database
-- restore into a single UPDATE. A follow-up migration drops it once this soaks.
alter table public.students rename column classroom_id to classroom_id_legacy;
alter table public.students alter column classroom_id_legacy drop not null;

comment on column public.students.classroom_id_legacy is
  'Pre-migration single-classroom assignment. Kept ONLY as a rollback source and NOT maintained - read classroom_students instead. Safe to drop once 20260807000001 has soaked.';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Recreate the anon-facing view without the column
-- ════════════════════════════════════════════════════════════════════════════

-- Deliberately NOT security_invoker: it runs with the owner's rights and so
-- bypasses students' RLS, which is the entire reason anon can read it.
create view public.students_public as
select id, name, roll, leetcode_id, created_at, last_scraped_at, scrape_error
from public.students;

grant select on public.students_public to anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Recreate the policies against the membership predicate
-- ════════════════════════════════════════════════════════════════════════════

-- The three child tables no longer join through students at all — they ask
-- has_student_access directly, which is both cheaper and removes a nested RLS
-- evaluation on public.students.
create policy "students authenticated select"
  on public.students for select
  using (has_student_access(auth.uid(), id));

create policy "student_stats authenticated select"
  on public.student_stats for select
  using (has_student_access(auth.uid(), student_id));

create policy "daily_snapshots authenticated select"
  on public.daily_snapshots for select
  using (has_student_access(auth.uid(), student_id));

create policy "recent_submissions authenticated select"
  on public.recent_submissions for select
  using (has_student_access(auth.uid(), student_id));
