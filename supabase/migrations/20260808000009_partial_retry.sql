-- Migration: an unfinished fetch must not be treated as a fresh one.
--
-- Re-runnable: `create or replace`, same signature, so no type regeneration.
--
-- platform_account_page skips accounts fetched inside the TTL. That is right for
-- a COMPLETED fetch and wrong for a truncated one: Codeforces derives its solve
-- count by walking a submission history that can take several chunks, and each
-- attempt stamps last_fetched_at. The account then looked fresh, got skipped for
-- the next 24 hours, and its backfill never finished — accounts sat at
-- total_solved = null indefinitely while the job cheerfully reported success.
--
-- fetch_status = 'partial' is the adapter saying "come back and finish this", so
-- it now overrides the TTL. Completed rows are unaffected.

create or replace function public.platform_account_page(
  p_platform_id  text,
  p_cursor       uuid        default null,
  p_limit        int         default 5,
  p_max_failures int         default 5,
  p_scope        text        default 'platform',
  p_classroom_id uuid        default null,
  p_student_ids  uuid[]      default null,
  p_stale_before timestamptz default null
)
returns table (
  account_id  uuid,
  student_id  uuid,
  handle      text,
  sync_cursor jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.student_id, a.handle, a.sync_cursor
  from public.student_platform_accounts a
  left join public.platform_stats ps on ps.account_id = a.id
  where a.platform_id = p_platform_id
    -- Served by student_platform_accounts_scan_idx, which excludes permanently
    -- broken handles from the index rather than filtering them per row.
    and a.status <> 'invalid_handle'
    and a.consecutive_failures < p_max_failures
    and a.id > coalesce(p_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      p_scope = 'platform'
      or (p_scope = 'classroom' and exists (
            select 1 from public.classroom_students cs
            where cs.student_id = a.student_id
              and cs.classroom_id = p_classroom_id))
      or (p_scope = 'students' and a.student_id = any(p_student_ids))
    )
    and (
      p_stale_before is null
      or a.last_fetched_at is null
      or a.last_fetched_at < p_stale_before
      -- The new clause: unfinished work is always due, whatever the TTL says.
      or ps.fetch_status = 'partial'
    )
  order by a.id
  limit greatest(p_limit, 1);
$$;

grant execute on function public.platform_account_page(text, uuid, int, int, text, uuid, uuid[], timestamptz)
  to service_role;
