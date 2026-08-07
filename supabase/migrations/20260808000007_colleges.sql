-- Migration: colleges become a real entity.
--
-- Re-runnable: `if not exists` / `or replace` / `on conflict do nothing`.
--
-- Until now "college" was not a thing in this schema — it was a computed scope
-- meaning "every student in the database", which is why student_ranks() ranked
-- against the whole table. That is fine with one institution and wrong the
-- moment there are two: a student's rank would start moving because of someone
-- at another campus.
--
-- Existing data is backfilled into a single college so nothing is orphaned and
-- every current query keeps returning what it returned before.
--
-- CEO is college-scoped through college_assignments (many colleges per user).
-- placement_officer is deliberately LEFT GLOBAL — re-scoping it would silently
-- change who can see 340 existing students, which is not a side effect a schema
-- migration should have. Flipping it later is one predicate in
-- has_student_access.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. colleges
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.colleges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  -- Stable handle for URLs and imports, so renaming the display name later does
  -- not break a spreadsheet column or a bookmarked link.
  slug        text not null unique,
  city        text,
  created_at  timestamptz not null default now()
);

comment on table public.colleges is
  'An institution. Classrooms belong to exactly one; CEOs are assigned to many.';

insert into public.colleges (name, slug)
values ('CMRTC', 'cmrtc')
on conflict (name) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. classrooms belong to a college
-- ════════════════════════════════════════════════════════════════════════════

alter table public.classrooms
  add column if not exists college_id uuid references public.colleges(id) on delete restrict;

-- Backfill every existing classroom into CMRTC before the column is required.
update public.classrooms
   set college_id = (select id from public.colleges where slug = 'cmrtc')
 where college_id is null;

do $$
begin
  if exists (select 1 from public.classrooms where college_id is null) then
    raise warning 'Some classrooms still have no college_id; leaving the column nullable.';
  else
    alter table public.classrooms alter column college_id set not null;
  end if;
end $$;

create index if not exists classrooms_college_idx on public.classrooms (college_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. college_assignments — which users see which colleges
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deliberately NOT named ceo_assignments. The grain is "user sees college", and
-- naming it after today's only consumer would mean renaming it the first time a
-- placement officer or a dean needs the same scoping.

create table if not exists public.college_assignments (
  user_id     uuid not null,
  college_id  uuid not null references public.colleges(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, college_id)
);

create index if not exists college_assignments_college_idx
  on public.college_assignments (college_id);

grant select on public.college_assignments to authenticated;
grant select, insert, delete on public.college_assignments to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Access predicates
-- ════════════════════════════════════════════════════════════════════════════
--
-- Each of these gains ONE new branch: a CEO reaches a classroom or student
-- through college_assignments. Everything else is untouched, so existing roles
-- keep exactly the access they had.

create or replace function public.has_college_access(_user uuid, _college uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1 from public.college_assignments
      where user_id = _user and college_id = _college
    );
$$;

grant execute on function public.has_college_access(uuid, uuid) to service_role, authenticated;

create or replace function public.has_classroom_access(_user uuid, _classroom uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1 from public.faculty_assignments
      where faculty_user_id = _user and classroom_id = _classroom
    )
    -- NEW: a CEO reaches every classroom in a college assigned to them.
    or exists (
      select 1
      from public.classrooms c
      join public.college_assignments ca on ca.college_id = c.college_id
      where c.id = _classroom and ca.user_id = _user
    );
$$;

grant execute on function public.has_classroom_access(uuid, uuid) to service_role, authenticated;

create or replace function public.has_student_access(_user uuid, _student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1
      from public.classroom_students cs
      join public.faculty_assignments fa on fa.classroom_id = cs.classroom_id
      where cs.student_id = _student and fa.faculty_user_id = _user
    )
    -- NEW: via any classroom of any college assigned to the user.
    or exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c          on c.id = cs.classroom_id
      join public.college_assignments ca on ca.college_id = c.college_id
      where cs.student_id = _student and ca.user_id = _user
    );
$$;

grant execute on function public.has_student_access(uuid, uuid) to service_role, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. A student's college, derived from membership
-- ════════════════════════════════════════════════════════════════════════════
--
-- Students are not linked to a college directly — they reach one through
-- classroom membership. A student in two classrooms of the same college has one
-- college; the (rare, probably erroneous) cross-college case resolves to the
-- earliest membership so ranking stays deterministic rather than returning two
-- rows and silently doubling the student in every aggregate.

create or replace view public.student_colleges as
select distinct on (cs.student_id)
  cs.student_id,
  c.college_id,
  col.name as college_name,
  col.slug as college_slug
from public.classroom_students cs
join public.classrooms c   on c.id = cs.classroom_id
join public.colleges   col on col.id = c.college_id
order by cs.student_id, cs.added_at, c.id;

comment on view public.student_colleges is
  'One college per student, resolved from the earliest classroom membership.';

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS
-- ════════════════════════════════════════════════════════════════════════════

alter table public.colleges enable row level security;
alter table public.college_assignments enable row level security;

drop policy if exists "colleges readable by authenticated" on public.colleges;
create policy "colleges readable by authenticated"
  on public.colleges for select
  to authenticated
  using (public.has_college_access(auth.uid(), id));

drop policy if exists "college_assignments own rows" on public.college_assignments;
create policy "college_assignments own rows"
  on public.college_assignments for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

grant select on public.colleges to authenticated;
grant select on public.student_colleges to authenticated;
