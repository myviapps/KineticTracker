-- Fix: a running job with lease_until = NULL was permanently unclaimable.
--
-- The predicate was `status = 'running' and lease_until < now()`. In SQL,
-- `NULL < now()` evaluates to NULL — not TRUE — so once a worker released its
-- lease by nulling the column, no subsequent claim could ever match. Exactly one
-- chunk ran per job and progress froze there forever.
--
-- The application no longer nulls the lease (it back-dates it instead), but this
-- makes the function correct regardless of how the column got to NULL — e.g. a
-- worker killed mid-chunk, or a manual edit.
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
      or (status = 'running' and (lease_until is null or lease_until < now()))
      or (status = 'paused' and (resume_after is null or resume_after <= now()))
    )
  returning * into v_job;

  if v_job.id is null then
    return null;
  end if;

  return to_jsonb(v_job);
end;
$$;

grant execute on function public.claim_refresh_job to service_role;

-- Hand a job back at the end of a chunk, using the DATABASE clock.
--
-- The app must never write lease_until itself. lease_until is set and compared
-- with Postgres now(), and app clocks drift from it — a dev machine measured 33
-- seconds ahead of Supabase, which put every "back-dated" release in the
-- database's future and stalled the job until the skew elapsed. Doing the
-- release in SQL keeps both sides of the comparison on one clock.
create or replace function public.release_refresh_job(
  p_job_id uuid,
  p_owner uuid
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
  set lease_owner = null,
      lease_until = now() - interval '1 second'
  where id = p_job_id
    and lease_owner = p_owner
    and status = 'running';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.release_refresh_job to service_role;

-- Unstick any job already frozen by the old predicate.
update public.refresh_jobs
set lease_until = now() - interval '1 second', lease_owner = null
where status = 'running' and lease_until is null;
