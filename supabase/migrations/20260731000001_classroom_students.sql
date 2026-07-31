-- Migration: a student may belong to MANY classrooms.
--
-- Re-runnable: every statement is `if not exists` / `or replace` / preceded by a
-- `drop ... if exists`, so applying this twice is a no-op rather than an error.
--
-- PHASE 1 of 2. Everything here is ADDITIVE: students.classroom_id, its FK, its
-- UNIQUE(classroom_id, roll), the students_public view and the four RLS policies
-- that read the column are all left untouched, and a trigger keeps the column in
-- sync with the join table. That means the previous app version keeps working
-- against this schema, so rolling back the deploy is a `git revert` rather than a
-- database restore.
--
-- Phase 2 (20260807000001) retires the column, adds UNIQUE(roll) and
-- UNIQUE(leetcode_id), and swaps the policies over. Run it only after every
-- duplicate reported below has been merged or corrected.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Pre-flight
-- ════════════════════════════════════════════════════════════════════════════

-- Duplicate rolls are REPORTED, not fatal.
--
-- Today the only way to put a student in two classrooms is two student rows, so a
-- roll appearing twice is almost always that workaround — the same person, waiting
-- to be merged into one record with two memberships. Aborting here would block the
-- migration on exactly the data it exists to fix, and would do it before the
-- cleanup UI has shipped. UNIQUE(roll) therefore lands in Phase 2, after you have
-- resolved these under Scrape History -> Duplicates.
do $$
declare v_n int; v_report text;
begin
  select count(*), string_agg(roll || ' x' || n, ', ' order by n desc)
    into v_n, v_report
  from (
    select roll, count(*) as n
    from public.students
    group by roll
    having count(*) > 1
    limit 50
  ) d;

  if coalesce(v_n, 0) > 0 then
    raise warning
      'ACTION REQUIRED: % roll number(s) are used by more than one student row: %. These are probably the same person enrolled in two classrooms. Resolve them under Scrape History -> Duplicates. The Phase 2 migration WILL abort on any that remain.',
      v_n, v_report;
  end if;
end $$;

-- Case-only collisions get their own warning, because Phase 2's UNIQUE(roll) is
-- case-SENSITIVE and would happily accept 22CS041 alongside 22cs041 — two student
-- records for one person that the constraint cannot catch. The duplicates screen
-- matches case-insensitively so these still surface there.
do $$
declare v_n int; v_report text;
begin
  select count(*), string_agg(lr, ', ' order by lr) into v_n, v_report
  from (
    select lower(trim(roll)) as lr
    from public.students
    group by lower(trim(roll))
    having count(*) > 1
    limit 50
  ) d;

  if coalesce(v_n, 0) > 0 then
    raise warning
      'NOTE: % roll(s) differ only by case or whitespace and will remain distinct students: %',
      v_n, v_report;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The join table
-- ════════════════════════════════════════════════════════════════════════════

-- Modelled on faculty_assignments: composite PK over both FKs, no surrogate id,
-- an added_at timestamp, cascade on both sides.
--
-- PK column order (classroom_id, student_id) is deliberate. The hot path is the
-- refresh worker's keyset scan
--     where classroom_id = $1 and student_id > $2 order by student_id limit n
-- which this PK serves as a single index range scan. Reversing the columns would
-- degrade it to a full index scan plus a sort on every batch.
create table if not exists public.classroom_students (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (classroom_id, student_id)
);

-- The reverse direction: "which classrooms is this student in?" — used by
-- has_student_access, the profile page and the overview rollup.
create index if not exists classroom_students_student_idx on public.classroom_students(student_id);

grant select, insert, delete on public.classroom_students to service_role;
grant select on public.classroom_students to authenticated;
alter table public.classroom_students enable row level security;

-- has_classroom_access is SECURITY DEFINER, so this does not recurse into this
-- table's own RLS.
drop policy if exists "classroom_students authenticated select" on public.classroom_students;
create policy "classroom_students authenticated select"
  on public.classroom_students for select
  using (has_classroom_access(auth.uid(), classroom_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Backfill, then prove it was total
-- ════════════════════════════════════════════════════════════════════════════

insert into public.classroom_students (classroom_id, student_id, added_at)
select s.classroom_id, s.id, s.created_at
from public.students s
on conflict do nothing;

do $$
declare v_students int; v_members int; v_orphans int;
begin
  select count(*) into v_students from public.students;
  select count(*) into v_members  from public.classroom_students;
  select count(*) into v_orphans
    from public.students s
   where not exists (
     select 1 from public.classroom_students cs where cs.student_id = s.id
   );

  -- What must hold is "every student has at least one classroom". Exact equality
  -- only holds on the very first run: as soon as anyone is enrolled in a second
  -- cohort, memberships legitimately exceed students, and demanding equality would
  -- make this migration abort on perfectly healthy data when re-run.
  if v_orphans > 0 or v_members < v_students then
    raise exception
      'ABORT: backfill incomplete - students=%, memberships=%, students with no membership=%',
      v_students, v_members, v_orphans;
  end if;

  raise notice 'backfill ok: % students -> % memberships', v_students, v_members;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Global identity
-- ════════════════════════════════════════════════════════════════════════════

-- NO unique constraints in this phase. Both `roll` and `leetcode_id` become
-- globally unique in Phase 2, once the duplicates reported above and below have
-- been merged or corrected. Adding either here would abort the migration on
-- pre-existing data and, worse, do it before the screen that fixes that data
-- exists. students_roll_idx stays — nothing supersedes it yet.

-- classroom_id becomes nullable NOW, even though the column survives until Phase 2.
-- From the Phase 1 deploy the app inserts a student and then a membership as two
-- statements and never supplies classroom_id; leaving it NOT NULL would reject
-- every new student for the whole overlap week. The sync trigger below fills it
-- microseconds later, off the membership insert, so the previous app version still
-- sees a populated column.
alter table public.students alter column classroom_id drop not null;

-- leetcode_id gets an INDEX now but its UNIQUE constraint only in Phase 2. The
-- index makes the duplicate scan and the import's existence check cheap. Deferring
-- the constraint means duplicate handles nobody has seen yet can never block this
-- migration, and the cleanup UI this migration enables ships first.
create index if not exists students_leetcode_id_idx on public.students(lower(leetcode_id));

do $$
declare v_n int; v_report text;
begin
  select count(*), string_agg(h || ' x' || n, ', ' order by n desc)
    into v_n, v_report
  from (
    select lower(trim(leetcode_id)) as h, count(*) as n
    from public.students
    group by lower(trim(leetcode_id))
    having count(*) > 1
    limit 50
  ) d;

  if coalesce(v_n, 0) > 0 then
    raise warning
      'ACTION REQUIRED: % LeetCode handle(s) are shared by more than one student: %. Resolve them under Scrape History -> Duplicates. The Phase 2 migration WILL abort on any that remain.',
      v_n, v_report;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. The access predicate, shared by SQL and TypeScript
-- ════════════════════════════════════════════════════════════════════════════

-- ANY-intersection: a student is reachable if ANY of their classrooms is one the
-- caller can reach.
--
-- SECURITY DEFINER so RLS policies can call it without recursing, and so authz.ts
-- can call it over RPC. One predicate, used by both the service-role path and the
-- anon-key path, so the two cannot drift — and only one of them is ever tested.
create or replace function public.has_student_access(_user uuid, _student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1
      from public.classroom_students cs
      join public.faculty_assignments fa on fa.classroom_id = cs.classroom_id
      where cs.student_id = _student
        and fa.faculty_user_id = _user
    );
$$;

grant execute on function public.has_student_access(uuid, uuid) to service_role, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Overlap-week sync trigger (Phase 2 drops this)
-- ════════════════════════════════════════════════════════════════════════════

-- Keeps students.classroom_id pointing at the earliest membership, so the PREVIOUS
-- app version remains a valid rollback target for the week. Throwaway by design:
-- nothing reads this column after the app deploy.
create or replace function public.sync_legacy_classroom_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_sid uuid;
begin
  v_sid := coalesce(new.student_id, old.student_id);

  update public.students s
     set classroom_id = coalesce(
       (select cs.classroom_id
          from public.classroom_students cs
         where cs.student_id = v_sid
         order by cs.added_at, cs.classroom_id
         limit 1),
       s.classroom_id)   -- last membership just went; leave the stale value, the
                         -- student row is about to be deleted anyway
   where s.id = v_sid;

  return null;
end $$;

drop trigger if exists classroom_students_sync_legacy on public.classroom_students;
create trigger classroom_students_sync_legacy
  after insert or delete on public.classroom_students
  for each row execute function public.sync_legacy_classroom_id();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Refresh worker: keyset page over a classroom
-- ════════════════════════════════════════════════════════════════════════════

-- The cursor stays a students.id, so refresh_jobs.cursor_student_id values written
-- BEFORE this migration remain valid after it and an in-flight job survives the
-- deploy. student_id is unique within a classroom, so `> cursor` is a total order
-- with no ties and no skips.
--
-- Deliberately an RPC rather than a PostgREST embed: a filter on an embedded
-- resource combined with a limit has surprising semantics, and the worker treats
-- "0 rows" as *queue drained*. That loop already carries a scar from exactly this
-- class of bug (see the discarded-error comment in refresh-worker.server.ts).
create or replace function public.classroom_student_page(
  p_classroom_id uuid,
  p_cursor uuid default null,
  p_limit int default 5,
  p_max_failures int default 5
)
returns table (id uuid, consecutive_failures int)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.consecutive_failures
  from public.classroom_students cs
  join public.students s on s.id = cs.student_id
  where cs.classroom_id = p_classroom_id
    and cs.student_id > coalesce(p_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
    and s.consecutive_failures < p_max_failures
  order by cs.student_id
  limit p_limit;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Headcounts
-- ════════════════════════════════════════════════════════════════════════════

-- Replaces listClassrooms' "pull every student row and tally in JS" pattern, which
-- was also silently truncated by PostgREST's 1000-row default.
create or replace function public.classroom_student_counts(p_classroom_ids uuid[] default null)
returns table (classroom_id uuid, student_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select cs.classroom_id, count(*)::bigint
  from public.classroom_students cs
  where p_classroom_ids is null or cs.classroom_id = any(p_classroom_ids)
  group by cs.classroom_id;
$$;

-- Distinct, because summing the per-classroom counts double-counts shared students
-- - which is exactly what the dashboard's headline figure used to do.
create or replace function public.distinct_student_count(p_classroom_ids uuid[] default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct cs.student_id)::bigint
  from public.classroom_students cs
  where p_classroom_ids is null or cs.classroom_id = any(p_classroom_ids);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Membership removal, with orphan pruning
-- ════════════════════════════════════════════════════════════════════════════

-- Deliberately an RPC and NOT an `after delete on classroom_students` trigger.
-- PostgREST calls are not transactional across statements: the moment anyone
-- writes a "sync this roster" flow as `delete memberships; insert memberships`
-- (two calls), a trigger would fire in between and destroy the student rows,
-- cascading away student_stats, daily_snapshots and recent_submissions. A function
-- body is one transaction; two PostgREST calls are not.
create or replace function public.remove_student_from_classroom(
  p_student uuid,
  p_classroom uuid
)
returns table (student_deleted boolean, remaining_classrooms int)
language plpgsql
security definer
set search_path = public
as $$
declare v_remaining int;
begin
  delete from public.classroom_students
   where student_id = p_student and classroom_id = p_classroom;

  select count(*) into v_remaining
    from public.classroom_students where student_id = p_student;

  if v_remaining = 0 then
    -- Last cohort: the student and all their history go. Cascades handle
    -- student_stats / daily_snapshots / recent_submissions.
    delete from public.students where id = p_student;
    return query select true, 0;
  end if;

  return query select false, v_remaining;
end $$;

-- What a classroom delete is about to do, so the confirm dialog can say it.
create or replace function public.classroom_delete_preview(p_classroom uuid)
returns table (orphan_count int, shared_count int)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where not exists (
      select 1 from public.classroom_students o
      where o.student_id = cs.student_id and o.classroom_id <> p_classroom
    ))::int,
    count(*) filter (where exists (
      select 1 from public.classroom_students o
      where o.student_id = cs.student_id and o.classroom_id <> p_classroom
    ))::int
  from public.classroom_students cs
  where cs.classroom_id = p_classroom;
$$;

-- Deleting a classroom drops its memberships (via cascade) and deletes ONLY the
-- students left with no classroom at all. Students enrolled elsewhere survive with
-- their full history.
create or replace function public.delete_classroom_cascade(p_classroom uuid)
returns table (students_deleted int, memberships_removed int)
language plpgsql
security definer
set search_path = public
as $$
declare v_orphans uuid[]; v_removed int;
begin
  -- Collected BEFORE the delete, while the memberships still exist.
  select coalesce(array_agg(cs.student_id), '{}')
    into v_orphans
  from public.classroom_students cs
  where cs.classroom_id = p_classroom
    and not exists (
      select 1 from public.classroom_students o
      where o.student_id = cs.student_id and o.classroom_id <> p_classroom
    );

  select count(*) into v_removed
    from public.classroom_students where classroom_id = p_classroom;

  delete from public.classrooms where id = p_classroom;   -- cascades memberships
  delete from public.students where id = any(v_orphans);  -- cascades all history

  return query select coalesce(array_length(v_orphans, 1), 0), v_removed;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Duplicate LeetCode handles
-- ════════════════════════════════════════════════════════════════════════════

-- One function for BOTH identity keys, because they are the same problem with the
-- same two fixes (merge, or correct one value) and the same Phase 2 consequence.
--
-- `kind='roll'` is the bigger group on a freshly-migrated database: two rows with
-- one roll is precisely how a student in two classrooms had to be represented
-- before this migration existed.
--
-- Matching is case-insensitive on both. Phase 2's UNIQUE constraints are
-- case-SENSITIVE (PostgREST can only infer on_conflict against an index on the
-- bare column), so the app normalizes on write and this scan surfaces anything
-- already differing only by case — which the constraint would happily allow while
-- still pointing two students at one LeetCode profile.
create or replace function public.duplicate_students()
returns table (
  kind text,
  value text,
  student_count int,
  students jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with keyed as (
    select 'roll'::text as kind, lower(trim(s.roll)) as value, s.*
    from public.students s
    union all
    select 'leetcode_id'::text, lower(trim(s.leetcode_id)), s.*
    from public.students s
  ),
  dupes as (
    select k.kind, k.value
    from keyed k
    group by k.kind, k.value
    having count(*) > 1
  )
  select
    d.kind,
    d.value,
    count(k.id)::int,
    jsonb_agg(jsonb_build_object(
      'id', k.id,
      'roll', k.roll,
      'name', k.name,
      'email', k.email,
      'leetcode_id', k.leetcode_id,
      'total_solved', coalesce(st.total_solved, 0),
      'snapshot_count', (
        select count(*) from public.daily_snapshots ds where ds.student_id = k.id
      ),
      'last_scraped_at', k.last_scraped_at,
      'classrooms', coalesce((
        select jsonb_agg(c.name order by c.name)
        from public.classroom_students cs
        join public.classrooms c on c.id = cs.classroom_id
        where cs.student_id = k.id
      ), '[]'::jsonb)
    ) order by k.roll, k.id)
  from dupes d
  join keyed k on k.kind = d.kind and k.value = d.value
  left join public.student_stats st on st.student_id = k.id
  group by d.kind, d.value
  -- Rolls first: they are the multi-classroom workaround and merging them is what
  -- unlocks the feature. Handles are a data-quality issue on top.
  order by (d.kind = 'roll') desc, count(k.id) desc, d.value;
$$;

-- Merge two students that turned out to be the same person.
--
-- One transaction. Unions memberships AND snapshot history rather than discarding
-- the loser's: both rows track the SAME LeetCode profile, so for a date only the
-- loser has, its snapshot is the only record of that day and dropping it would put
-- a permanent hole in the survivor's Daily Matrix.
create or replace function public.merge_students(p_survivor uuid, p_loser uuid)
returns table (memberships_moved int, snapshots_moved int)
language plpgsql
security definer
set search_path = public
as $$
declare v_mem int; v_snap int;
begin
  if p_survivor = p_loser then
    raise exception 'merge_students: survivor and loser must differ';
  end if;
  -- Guard against merging two genuinely different people. They must currently
  -- collide on at least one identity key; if the screen was stale and somebody
  -- already fixed the value, this refuses rather than destroying a record.
  if not exists (
    select 1 from public.students a, public.students b
    where a.id = p_survivor and b.id = p_loser
      and (lower(trim(a.roll)) = lower(trim(b.roll))
        or lower(trim(a.leetcode_id)) = lower(trim(b.leetcode_id)))
  ) then
    raise exception
      'merge_students: these two students no longer share a roll number or a LeetCode ID';
  end if;
  if not exists (select 1 from public.students where id = p_survivor) then
    raise exception 'merge_students: survivor % not found', p_survivor;
  end if;
  if not exists (select 1 from public.students where id = p_loser) then
    raise exception 'merge_students: loser % not found', p_loser;
  end if;

  insert into public.classroom_students (classroom_id, student_id, added_at)
  select cs.classroom_id, p_survivor, cs.added_at
  from public.classroom_students cs
  where cs.student_id = p_loser
  on conflict do nothing;
  get diagnostics v_mem = row_count;

  -- Same profile, so on a date both rows have, the larger total is the later and
  -- therefore correct read.
  insert into public.daily_snapshots as tgt (
    student_id, snapshot_date, total_solved,
    easy_solved, medium_solved, hard_solved, solved_that_day
  )
  select p_survivor, ds.snapshot_date, ds.total_solved,
         ds.easy_solved, ds.medium_solved, ds.hard_solved, ds.solved_that_day
  from public.daily_snapshots ds
  where ds.student_id = p_loser
  on conflict (student_id, snapshot_date) do update
    set total_solved    = greatest(tgt.total_solved,    excluded.total_solved),
        easy_solved     = greatest(tgt.easy_solved,     excluded.easy_solved),
        medium_solved   = greatest(tgt.medium_solved,   excluded.medium_solved),
        hard_solved     = greatest(tgt.hard_solved,     excluded.hard_solved),
        solved_that_day = greatest(tgt.solved_that_day, excluded.solved_that_day);
  get diagnostics v_snap = row_count;

  -- If the loser was scraped more recently, its stats are the fresher read.
  update public.student_stats surv
     set real_name = lose.real_name,
         avatar = lose.avatar,
         country = lose.country,
         reputation = lose.reputation,
         ranking = lose.ranking,
         total_solved = lose.total_solved,
         total_questions = lose.total_questions,
         easy_solved = lose.easy_solved,
         easy_total = lose.easy_total,
         medium_solved = lose.medium_solved,
         medium_total = lose.medium_total,
         hard_solved = lose.hard_solved,
         hard_total = lose.hard_total,
         acceptance_rate = lose.acceptance_rate,
         streak = lose.streak,
         total_active_days = lose.total_active_days,
         contest_rating = lose.contest_rating,
         contest_global_ranking = lose.contest_global_ranking,
         contests_attended = lose.contests_attended,
         contest_top_percentage = lose.contest_top_percentage,
         submission_calendar = lose.submission_calendar,
         language_stats = lose.language_stats,
         tag_stats = lose.tag_stats,
         badges = lose.badges,
         updated_at = lose.updated_at
    from public.student_stats lose
   where surv.student_id = p_survivor
     and lose.student_id = p_loser
     and lose.updated_at > surv.updated_at;

  -- recent_submissions is a rolling window rebuilt on the next scrape, so it is
  -- deliberately not merged.
  delete from public.students where id = p_loser;   -- cascades the rest

  return query select v_mem, v_snap;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. enqueue_refresh_job: count memberships for a classroom run
-- ════════════════════════════════════════════════════════════════════════════

-- Same 7-arg signature as 20260730000001, so this replaces rather than overloads.
-- Only the p_scope = 'classroom' branch changes.
create or replace function public.enqueue_refresh_job(
  p_scope text,
  p_classroom_id uuid default null,
  p_student_ids uuid[] default null,
  p_filter text default 'all',
  p_created_by uuid default null,
  p_stale_before timestamptz default null,
  p_force boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_id uuid;
  v_active uuid;
begin
  -- Reap a job whose lease expired long ago.
  update public.refresh_jobs
  set status = 'cancelled', finished_at = now(), lease_owner = null, lease_until = null
  where status = 'running'
    and lease_until is not null
    and lease_until < now() - interval '2 minutes';

  select id into v_active
  from public.refresh_jobs
  where status in ('queued','running')
  limit 1;

  if v_active is not null then
    if not p_force then
      raise exception 'refresh_already_active';
    end if;
    update public.refresh_jobs
    set status = 'cancelled', finished_at = now(), lease_owner = null, lease_until = null
    where id = v_active;
  end if;

  if p_scope = 'classroom' then
    -- Was: count(*) from students where classroom_id = p_classroom_id
    select count(*) into v_total from public.classroom_students
      where classroom_id = p_classroom_id;
  elsif p_scope = 'platform' then
    -- Still students, NOT memberships: a student shared by two cohorts is scraped
    -- once by a platform run, so counting memberships would make the progress
    -- bar's denominator unreachable and the job would never read as complete.
    select count(*) into v_total from public.students;
  elsif p_scope = 'students' then
    v_total := coalesce(array_length(p_student_ids, 1), 0);
  end if;

  insert into public.refresh_jobs (
    scope, classroom_id, student_ids, filter, stale_before, total, created_by
  ) values (
    p_scope, p_classroom_id, p_student_ids, p_filter, p_stale_before,
    coalesce(v_total, 0), p_created_by
  )
  returning id into v_id;

  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Grants
-- ════════════════════════════════════════════════════════════════════════════

grant execute on function public.classroom_student_page(uuid, uuid, int, int)      to service_role;
grant execute on function public.classroom_student_counts(uuid[])                  to service_role;
grant execute on function public.distinct_student_count(uuid[])                    to service_role;
grant execute on function public.remove_student_from_classroom(uuid, uuid)         to service_role;
grant execute on function public.classroom_delete_preview(uuid)                    to service_role;
grant execute on function public.delete_classroom_cascade(uuid)                    to service_role;
grant execute on function public.duplicate_students()                              to service_role;
grant execute on function public.merge_students(uuid, uuid)                        to service_role;
grant execute on function public.enqueue_refresh_job(text, uuid, uuid[], text, uuid, timestamptz, boolean) to service_role;
