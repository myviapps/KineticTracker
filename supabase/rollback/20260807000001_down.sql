-- ROLLBACK for the many-classrooms migration. NOT a migration — kept here
-- deliberately unapplied, to be run by hand in a maintenance window.
--
-- Rolling back Phase 1 alone needs nothing from this file: Phase 1 is additive and
-- the sync trigger keeps students.classroom_id valid, so `git revert` of the app
-- deploy is sufficient. This file undoes Phase 2 (20260807000001) and then, if you
-- want to go all the way, Phase 1 (20260731000001).
--
-- ┌─ WHAT YOU LOSE ──────────────────────────────────────────────────────────┐
-- │ Second and subsequent memberships. A student in three cohorts collapses  │
-- │ to one. Step 0 snapshots them so you can replay by hand later.           │
-- │                                                                          │
-- │ Merges are NOT recoverable by this file at all — merge_students deletes  │
-- │ the loser and its history is gone.                                       │
-- └──────────────────────────────────────────────────────────────────────────┘

begin;

-- ─── 0. Record what is about to be lost ────────────────────────────────────
create table if not exists public._rollback_lost_memberships as
select cs.*
from public.classroom_students cs
where cs.classroom_id is distinct from (
  select o.classroom_id from public.classroom_students o
  where o.student_id = cs.student_id
  order by o.added_at, o.classroom_id
  limit 1
);

-- ─── 1. Undo Phase 2 ───────────────────────────────────────────────────────
alter table public.students drop constraint if exists students_leetcode_id_key;

drop policy if exists "students authenticated select"           on public.students;
drop policy if exists "student_stats authenticated select"      on public.student_stats;
drop policy if exists "daily_snapshots authenticated select"    on public.daily_snapshots;
drop policy if exists "recent_submissions authenticated select" on public.recent_submissions;
drop view if exists public.students_public;

alter table public.students rename column classroom_id_legacy to classroom_id;

-- Students created AFTER the migration have a NULL legacy column: give them their
-- earliest membership.
update public.students s
   set classroom_id = (
     select cs.classroom_id from public.classroom_students cs
     where cs.student_id = s.id
     order by cs.added_at, cs.classroom_id
     limit 1)
 where s.classroom_id is null;

-- A student with neither a legacy value nor a membership cannot satisfy NOT NULL.
-- There should be none; this exists so the next statement cannot fail.
delete from public.students where classroom_id is null;

alter table public.students alter column classroom_id set not null;
alter table public.students
  add constraint students_classroom_id_fkey
  foreign key (classroom_id) references public.classrooms(id) on delete cascade;
alter table public.students drop constraint if exists students_roll_key;
alter table public.students
  add constraint students_classroom_id_roll_key unique (classroom_id, roll);
create index if not exists students_roll_idx on public.students(roll);
create index if not exists students_classroom_idx on public.students(classroom_id);

-- Restored verbatim from 20260718000001_role_based_access.sql:80-83 and :142-177.
create or replace view public.students_public as
select id, name, roll, leetcode_id, classroom_id, created_at, last_scraped_at, scrape_error
from public.students;
grant select on public.students_public to anon;

create policy "students authenticated select"
  on public.students for select
  using (has_classroom_access(auth.uid(), classroom_id));

create policy "student_stats authenticated select"
  on public.student_stats for select
  using (exists (select 1 from public.students
                 where students.id = student_stats.student_id
                   and has_classroom_access(auth.uid(), students.classroom_id)));

create policy "daily_snapshots authenticated select"
  on public.daily_snapshots for select
  using (exists (select 1 from public.students
                 where students.id = daily_snapshots.student_id
                   and has_classroom_access(auth.uid(), students.classroom_id)));

create policy "recent_submissions authenticated select"
  on public.recent_submissions for select
  using (exists (select 1 from public.students
                 where students.id = recent_submissions.student_id
                   and has_classroom_access(auth.uid(), students.classroom_id)));

-- ─── 2. Undo Phase 1 ───────────────────────────────────────────────────────
drop trigger if exists classroom_students_sync_legacy on public.classroom_students;
drop function if exists public.sync_legacy_classroom_id();

drop function if exists public.merge_students(uuid, uuid);
drop function if exists public.duplicate_leetcode_ids();
drop function if exists public.delete_classroom_cascade(uuid);
drop function if exists public.classroom_delete_preview(uuid);
drop function if exists public.remove_student_from_classroom(uuid, uuid);
drop function if exists public.distinct_student_count(uuid[]);
drop function if exists public.classroom_student_counts(uuid[]);
drop function if exists public.classroom_student_page(uuid, uuid, int, int);
drop function if exists public.has_student_access(uuid, uuid);

drop index if exists public.students_leetcode_id_idx;
drop table if exists public.classroom_students;

-- Restore enqueue_refresh_job verbatim from 20260730000001_authz_hardening.sql.
-- (Paste that file's definition here before running — it is not duplicated in this
-- file so the two cannot drift.)
\echo 'REMINDER: restore enqueue_refresh_job from 20260730000001_authz_hardening.sql:22-87'

commit;
