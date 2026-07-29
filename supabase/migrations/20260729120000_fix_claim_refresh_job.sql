-- Fix: claim_refresh_job referenced row_to_jsonb(), which does not exist in Postgres.
-- Every call failed with 42883, so no refresh job was ever claimed and jobs sat in
-- 'queued' forever with started_at = null. The correct function is to_jsonb().
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

  return to_jsonb(v_job);
end;
$$;

grant execute on function public.claim_refresh_job to service_role;
