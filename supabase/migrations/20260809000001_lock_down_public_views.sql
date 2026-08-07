-- Security hardening: close the anonymous data-exposure hole, and tighten two
-- policies plus one function-grant that the 20260730000001 hardening pass missed.
--
-- ============================================================================
-- THE BUG (C-1)
-- ============================================================================
-- 20260718000001 revoked anon SELECT on the base tables (students, student_stats,
-- daily_snapshots, recent_submissions, classrooms) and instead granted anon SELECT
-- on five "safe projection" views. But a Postgres view runs with its OWNER's
-- rights unless it is declared `security_invoker`, and none of these were. So the
-- views did not merely project columns — they bypassed RLS entirely.
--
-- Those views live in schema `public`, so PostgREST exposes them, and
-- VITE_SUPABASE_PUBLISHABLE_KEY ships in the client bundle by design. The net
-- effect was that anyone could run
--
--     GET /rest/v1/students_public?select=*
--     GET /rest/v1/student_stats_public?select=*
--     GET /rest/v1/recent_submissions_public?select=*
--
-- and dump every student's name, roll, platform handles, real name, country,
-- ranking, submission calendar and full daily-snapshot history — unauthenticated.
--
-- That defeated maskName/maskHandle in src/lib/mask.ts, the anti-enumeration
-- redesign of searchStudents, and the "anon is revoked" claim in
-- src/lib/landing.functions.ts. The base-table revokes made it LOOK safe.
--
-- ============================================================================
-- WHY REVOKING IS SAFE
-- ============================================================================
-- The application never reads these views. Verified by grep over src/: the only
-- references are generated FK metadata in src/integrations/supabase/types.ts.
-- Public student lookup goes through server functions (getStudentByRoll,
-- searchStudents) which use the service-role client and apply masking in
-- TypeScript. Students can still look themselves up by roll with no account —
-- that flow does not depend on any anon grant.
--
-- The only thing the browser's anon client ever touches is supabase.auth.* plus
-- one authenticated read of user_roles (src/lib/auth.functions.ts:26), which is
-- granted to `authenticated`, not `anon`, and is RLS-gated to the caller's own
-- rows. So no anon table grant is load-bearing anywhere.
--
-- Belt and braces: we both revoke the grant AND set security_invoker, so that
-- re-adding a grant by accident in future cannot reopen the hole — RLS would
-- still apply.

-- 1. The five anon-readable views ------------------------------------------
revoke select on public.students_public from anon;
revoke select on public.student_stats_public from anon;
revoke select on public.daily_snapshots_public from anon;
revoke select on public.recent_submissions_public from anon;
revoke select on public.classrooms_public from anon;

alter view public.students_public set (security_invoker = true);
alter view public.student_stats_public set (security_invoker = true);
alter view public.daily_snapshots_public set (security_invoker = true);
alter view public.recent_submissions_public set (security_invoker = true);
alter view public.classrooms_public set (security_invoker = true);

-- 2. The three authenticated-readable views ---------------------------------
-- Smaller blast radius (a login is required) but the same defect: any signed-in
-- account — including a faculty member with zero classroom assignments — could
-- read every student's Almanac score, every student→college mapping, and every
-- college's rollup, with no has_*_access predicate applied.
--
-- These three ARE used by the app (colleges.functions.ts:36,124), but only via
-- the service-role client, which has BYPASSRLS. Turning on security_invoker
-- therefore constrains `authenticated` callers without affecting the app.
alter view public.student_scores set (security_invoker = true);
alter view public.student_colleges set (security_invoker = true);
alter view public.college_overview set (security_invoker = true);

-- 3. Platform config no longer readable by anon ------------------------------
-- 20260808000001 granted this to anon and gave it a `using (true)` policy for
-- anon. It exposes per-platform scoring weights, rating baselines and internal
-- `notes`. Nothing in the browser reads it — the landing page gets its counts
-- from getLandingStats via the service-role client.
revoke select on public.platforms from anon;
drop policy if exists "platforms readable by all" on public.platforms;
create policy "platforms readable by authenticated"
  on public.platforms for select to authenticated using (true);

-- 4. scrape_runs: role-gate reads (M-4) --------------------------------------
-- Was `for select using (true)` + grant to authenticated, so any account with
-- any role — or none — could read the errors jsonb, which quotes the handles of
-- failing students. 20260730000001 fixed refresh_jobs and faculty_assignments
-- this exact way; scrape_runs was missed. Scrape history is an operational
-- surface, so restrict it to the roles that can act on it.
drop policy if exists "scrape_runs read for all authenticated" on public.scrape_runs;
create policy "scrape_runs read for staff"
  on public.scrape_runs for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'placement_officer')
  );

-- 5. college_platforms: scope by college assignment (M-4) --------------------
-- Was `using (true)` for every authenticated user, inconsistent with the
-- `colleges` table itself (20260808000007:199), which IS scoped by
-- has_college_access.
drop policy if exists "college_platforms readable by authenticated" on public.college_platforms;
create policy "college_platforms readable by college members"
  on public.college_platforms for select to authenticated
  using (public.has_college_access(auth.uid(), college_id));

-- 6. Close the permission oracle (M-5) ---------------------------------------
-- These four predicates take an arbitrary `_user uuid` and are executable by
-- `authenticated`, so any signed-in user could probe another staff member's
-- access scope one RPC at a time:
--
--     rpc('has_student_access', { _user: '<someone else>', _student: '<uuid>' })
--
-- The obvious fix — `revoke execute ... from authenticated` — is WRONG here.
-- RLS policy expressions are evaluated with the querying user's privileges, and
-- these predicates are the entire body of the policies on students,
-- student_stats, daily_snapshots, recent_submissions, classrooms, colleges and
-- student_platform_accounts. Revoking EXECUTE would make every authenticated
-- PostgREST read fail with "permission denied for function" — it would break RLS
-- rather than tighten it.
--
-- Instead each predicate now refuses to answer about anyone but the caller.
-- The guard is `auth.uid() is null or _user = auth.uid()`:
--
--   * service-role (the application) — auth.uid() is NULL, so the guard passes
--     and behaviour is unchanged. This is the only caller that legitimately asks
--     about a third party.
--   * authenticated asking about itself — which is the ONLY form the RLS
--     policies ever use, since they all call has_*(auth.uid(), ...) — passes.
--   * authenticated asking about someone else — returns false. Oracle closed.
--
-- (anon can reach the NULL branch in principle but has no EXECUTE grant on any
-- of these, so it cannot call them at all.)

create or replace function public.has_role(_user uuid, _role public.app_role)
returns boolean
language sql
security definer
set search_path = public
as $$
  select (auth.uid() is null or _user = auth.uid()) and exists (
    select 1 from public.user_roles
    where user_id = _user and role = _role
  );
$$;

create or replace function public.has_college_access(_user uuid, _college uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.uid() is null or _user = auth.uid()) and (
    exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1 from public.college_assignments
      where user_id = _user and college_id = _college
    )
  );
$$;

create or replace function public.has_classroom_access(_user uuid, _classroom uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.uid() is null or _user = auth.uid()) and (
    exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1 from public.faculty_assignments
      where faculty_user_id = _user and classroom_id = _classroom
    )
    or exists (
      select 1
      from public.classrooms c
      join public.college_assignments ca on ca.college_id = c.college_id
      where c.id = _classroom and ca.user_id = _user
    )
  );
$$;

create or replace function public.has_student_access(_user uuid, _student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.uid() is null or _user = auth.uid()) and (
    exists (
      select 1 from public.user_roles
      where user_id = _user and role in ('admin', 'placement_officer')
    )
    or exists (
      select 1
      from public.classroom_students cs
      join public.faculty_assignments fa on fa.classroom_id = cs.classroom_id
      where cs.student_id = _student and fa.faculty_user_id = _user
    )
    or exists (
      select 1
      from public.classroom_students cs
      join public.classrooms c           on c.id = cs.classroom_id
      join public.college_assignments ca on ca.college_id = c.college_id
      where cs.student_id = _student and ca.user_id = _user
    )
  );
$$;
