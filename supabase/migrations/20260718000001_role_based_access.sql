-- Migration: Role-based access, refresh locks, public views, RLS retightening

-- 1. Enums
do $$ begin
  create type app_role as enum ('admin', 'placement_officer', 'faculty');
exception
  when duplicate_object then null;
end $$;

-- 2. user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique(user_id, role)
);
grant select, insert, delete on public.user_roles to service_role;
grant select on public.user_roles to authenticated;
alter table public.user_roles enable row level security;
-- Only service_role inserts/deletes; authenticated can read for their own role check
create policy "user_roles authenticated select own" on public.user_roles
  for select using (auth.uid() = user_id);

-- 3. faculty_assignments
create table public.faculty_assignments (
  faculty_user_id uuid not null references auth.users(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (faculty_user_id, classroom_id)
);
grant select, insert, delete on public.faculty_assignments to service_role;
grant select on public.faculty_assignments to authenticated;
alter table public.faculty_assignments enable row level security;
create policy "faculty_assignments authenticated read" on public.faculty_assignments
  for select using (true);

-- 4. refresh_locks (single-row semantics per lock_key)
create table public.refresh_locks (
  lock_key text primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
grant select, insert, delete on public.refresh_locks to service_role;
grant select on public.refresh_locks to authenticated;
alter table public.refresh_locks enable row level security;
create policy "refresh_locks all only service" on public.refresh_locks
  for all using (false);

-- 5. Helper functions (SECURITY DEFINER)
create or replace function public.has_role(_user uuid, _role app_role)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user and role = _role
  );
$$;

create or replace function public.has_classroom_access(_user uuid, _classroom uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.user_roles where user_id = _user and role = 'admin')
    or exists (select 1 from public.user_roles where user_id = _user and role = 'placement_officer')
    or exists (
      select 1 from public.faculty_assignments
      where faculty_user_id = _user and classroom_id = _classroom
    );
$$;

-- 6. Public views (safe projections)
create or replace view public.students_public as
select
  id, name, roll, leetcode_id, classroom_id, created_at, last_scraped_at, scrape_error
from public.students;

create or replace view public.student_stats_public as
select
  student_id, avatar, real_name, country, ranking, total_solved, total_questions,
  easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total,
  acceptance_rate, streak, total_active_days,
  contest_rating, contest_global_ranking, contests_attended, contest_top_percentage,
  submission_calendar, language_stats, tag_stats, badges, updated_at
from public.student_stats;

create or replace view public.daily_snapshots_public as
select * from public.daily_snapshots;

create or replace view public.recent_submissions_public as
select * from public.recent_submissions;

create or replace view public.classrooms_public as
select id, name, description, created_at from public.classrooms;

grant select on public.students_public to anon;
grant select on public.student_stats_public to anon;
grant select on public.daily_snapshots_public to anon;
grant select on public.recent_submissions_public to anon;
grant select on public.classrooms_public to anon;

-- 7. RLS retightening

-- Drop existing broad policies
drop policy if exists "classrooms public read" on public.classrooms;
drop policy if exists "students public read" on public.students;
drop policy if exists "student_stats public read" on public.student_stats;
drop policy if exists "daily_snapshots public read" on public.daily_snapshots;
drop policy if exists "recent_submissions public read" on public.recent_submissions;

-- Revoke anon SELECT on base tables (cleanup)
revoke select on public.classrooms from anon;
revoke select on public.students from anon;
revoke select on public.student_stats from anon;
revoke select on public.daily_snapshots from anon;
revoke select on public.recent_submissions from anon;

-- Authenticated gets SELECT on base tables, gated by RLS
grant select on public.classrooms to authenticated;
grant select on public.students to authenticated;
grant select on public.student_stats to authenticated;
grant select on public.daily_snapshots to authenticated;
grant select on public.recent_submissions to authenticated;

-- RLS policies for authenticated users

-- classrooms: visible if user has access to at least one student in it OR has any role
create policy "classrooms authenticated select"
  on public.classrooms for select
  using (
    exists (select 1 from public.user_roles where user_id = auth.uid())
  );

-- students: visible if user has_classroom_access to their classroom
create policy "students authenticated select"
  on public.students for select
  using (has_classroom_access(auth.uid(), classroom_id));

-- student_stats: visible through same gate (via join to students)
create policy "student_stats authenticated select"
  on public.student_stats for select
  using (
    exists (
      select 1 from public.students
      where students.id = student_stats.student_id
        and has_classroom_access(auth.uid(), students.classroom_id)
    )
  );

-- daily_snapshots: same gate
create policy "daily_snapshots authenticated select"
  on public.daily_snapshots for select
  using (
    exists (
      select 1 from public.students
      where students.id = daily_snapshots.student_id
        and has_classroom_access(auth.uid(), students.classroom_id)
    )
  );

-- recent_submissions: same gate
create policy "recent_submissions authenticated select"
  on public.recent_submissions for select
  using (
    exists (
      select 1 from public.students
      where students.id = recent_submissions.student_id
        and has_classroom_access(auth.uid(), students.classroom_id)
    )
  );
