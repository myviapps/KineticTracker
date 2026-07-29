-- Migration: Durable batched refresh jobs
-- Replaces the one-at-a-time serial loop with resumable batch jobs

-- 1. Main job table
create table if not exists public.refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  lock_key text not null default 'global',
  scope text not null check (scope in ('platform','classroom','students')),
  classroom_id uuid references public.classrooms(id) on delete cascade,
  student_ids uuid[],
  filter text not null default 'all' check (filter in ('all','stale','failed')),
  stale_before timestamptz,
  status text not null default 'queued'
    check (status in ('queued','running','paused','completed','failed','cancelled')),
  total int not null default 0,
  processed int not null default 0,
  succeeded int not null default 0,
  failed int not null default 0,
  batch_size int not null default 5,
  cooldown_ms int not null default 3000,
  clean_streak int not null default 0,
  cursor_student_id uuid,
  lease_owner uuid,
  lease_until timestamptz,
  resume_after timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  errors jsonb not null default '[]'
);

-- Single-flight: at most one queued/running job at a time
-- 'paused' is deliberately excluded so a rate-limited job can never block forever
create unique index if not exists refresh_jobs_single_flight
  on public.refresh_jobs (lock_key) where status in ('queued','running');

create index if not exists refresh_jobs_reaper_idx
  on public.refresh_jobs (status, resume_after);

grant select on public.refresh_jobs to authenticated;
grant all on public.refresh_jobs to service_role;

alter table public.refresh_jobs enable row level security;
drop policy if exists "refresh_jobs authenticated select" on public.refresh_jobs;
create policy "refresh_jobs authenticated select"
  on public.refresh_jobs for select using (true);

-- 2. Add consecutive_failures to students
alter table public.students
  add column if not exists consecutive_failures int not null default 0;

-- 3. RPC: enqueue_refresh_job — cancel-stale-then-insert in one transaction
create or replace function public.enqueue_refresh_job(
  p_scope text,
  p_classroom_id uuid default null,
  p_student_ids uuid[] default null,
  p_filter text default 'all',
  p_created_by uuid default null,
  p_stale_before timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_id uuid;
begin
  -- Cancel any stale queued/running jobs so the unique index doesn't block
  update public.refresh_jobs
  set status = 'cancelled', finished_at = now()
  where status in ('queued','running');

  -- Count target students
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

-- 4. RPC: claim_refresh_job — atomic lease acquire
create or replace function public.claim_refresh_job(
  p_job_id uuid,
  p_lease_seconds int default 30,
  p_owner uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.refresh_jobs%rowtype;
begin
  update public.refresh_jobs
  set
    status = 'running',
    lease_owner = p_owner,
    lease_until = now() + (p_lease_seconds || ' seconds')::interval,
    started_at = coalesce(started_at, now()),
    resume_after = null,
    last_error = null
  where id = p_job_id
    and (
      status = 'queued'
      or (status = 'running' and lease_until < now())
      or (status = 'paused' and (resume_after is null or resume_after <= now()))
    )
  returning * into v_job;

  if v_job.id is null then
    return null;
  end if;

  return row_to_jsonb(v_job);
end;
$$;

-- 5. RPC: commit_refresh_batch — atomic cursor advance + counter bump
create or replace function public.commit_refresh_batch(
  p_job_id uuid,
  p_owner uuid,
  p_expected_cursor uuid,
  p_new_cursor uuid,
  p_ok int,
  p_failed int,
  p_cooldown_ms int,
  p_clean_streak int,
  p_errors jsonb default '[]',
  p_done boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.refresh_jobs
  set
    cursor_student_id = p_new_cursor,
    processed = processed + p_ok + p_failed,
    succeeded = succeeded + p_ok,
    failed = failed + p_failed,
    cooldown_ms = p_cooldown_ms,
    clean_streak = p_clean_streak,
    errors = case
      when p_errors is not null and jsonb_array_length(p_errors) > 0
        then refresh_jobs.errors || p_errors
      else refresh_jobs.errors
    end,
    lease_until = case
      when p_done then lease_until
      else now() + interval '30 seconds'
    end,
    status = case
      when p_done then 'completed'
      else 'running'
    end,
    finished_at = case when p_done then now() else null end,
    last_error = case
      when p_errors is not null and jsonb_array_length(p_errors) > 0
        then (p_errors->>0)::text
      else null
    end
  where id = p_job_id
    and lease_owner = p_owner
    and cursor_student_id is not distinct from p_expected_cursor;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.enqueue_refresh_job to service_role;
grant execute on function public.claim_refresh_job to service_role;
grant execute on function public.commit_refresh_batch to service_role;
