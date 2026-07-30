-- Migration: authorization hardening
--
-- 1. enqueue_refresh_job no longer silently cancels someone else's running job
-- 2. faculty_assignments is no longer world-readable to every authenticated user
-- 3. refresh_jobs select is restricted to users who actually hold a role
-- 4. site_settings update policy keyed off a role model this app never populated

-- ─── 1. Refresh job ownership ───────────────────────────────────────────────
-- The old body opened with an unconditional
--   update refresh_jobs set status='cancelled' where status in ('queued','running')
-- so ANY caller starting a refresh destroyed whatever was already in flight. A
-- faculty member refreshing one classroom would kill an admin's platform-wide run
-- 900 students in, and the only thing standing in the way was a `disabled` prop in
-- the browser. Now an active job is only displaced when p_force is passed, which
-- the server function permits for admins alone.
--
-- Dropped rather than replaced: adding a parameter to `create or replace function`
-- registers an overload instead of replacing, which would leave PostgREST choosing
-- between two candidate signatures.
drop function if exists public.enqueue_refresh_job(text, uuid, uuid[], text, uuid, timestamptz);

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
  -- Reap genuinely dead jobs first: a 'running' row whose lease expired has no
  -- worker behind it any more, so it is not something we need to protect.
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
      -- Signalled as a message the server function matches on, so the browser
      -- gets "a refresh is already running" instead of a unique-index violation.
      raise exception 'refresh_already_active';
    end if;

    update public.refresh_jobs
    set status = 'cancelled', finished_at = now(), lease_owner = null, lease_until = null
    where id = v_active;
  end if;

  if p_scope = 'classroom' then
    select count(*) into v_total from public.students
      where classroom_id = p_classroom_id;
  elsif p_scope = 'platform' then
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
end;
$$;

grant execute on function public.enqueue_refresh_job to service_role;

-- ─── 2. faculty_assignments ─────────────────────────────────────────────────
-- Was `for select using (true)`: every authenticated user could read the entire
-- staff-to-classroom map. Faculty only need their own rows; admins and placement
-- officers need all of them for the staff screen.
drop policy if exists "faculty_assignments authenticated read" on public.faculty_assignments;
create policy "faculty_assignments select own or privileged"
  on public.faculty_assignments for select
  using (
    faculty_user_id = auth.uid()
    or has_role(auth.uid(), 'admin')
    or has_role(auth.uid(), 'placement_officer')
  );

-- ─── 3. refresh_jobs ────────────────────────────────────────────────────────
-- Was `for select using (true)`. The rows carry a `created_by` uuid and an
-- `errors` jsonb that quotes failing LeetCode handles, so restrict reads to
-- users holding any staff role.
drop policy if exists "refresh_jobs authenticated select" on public.refresh_jobs;
create policy "refresh_jobs staff select"
  on public.refresh_jobs for select
  using (exists (select 1 from public.user_roles where user_id = auth.uid()));

-- ─── 4. site_settings ───────────────────────────────────────────────────────
-- The update policy tested `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`.
-- Nothing in this application writes app_metadata.role — roles live in
-- public.user_roles — so the policy could never match and only appeared to work
-- because writes go through the service-role key. Point it at the real model.
drop policy if exists "Allow admins to update site_settings" on public.site_settings;
create policy "site_settings admin update"
  on public.site_settings for update
  to authenticated
  using (has_role(auth.uid(), 'admin'))
  with check (has_role(auth.uid(), 'admin'));
