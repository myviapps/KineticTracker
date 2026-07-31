-- College-wide rank by problems solved.
--
-- The students table already had a `rank`, but it is LeetCode's WORLDWIDE ranking
-- off the scraped profile — nothing to do with standing inside this institution.
-- Classroom rank is cheap to compute in the browser from a roster you already
-- hold; college rank is not, because it depends on every student in the platform,
-- and pulling them all to the client to sort would hit PostgREST's row cap and
-- leak the whole directory.
--
-- Re-runnable.

create or replace function public.student_college_ranks(p_student_ids uuid[])
returns table (student_id uuid, college_rank int, total_ranked int)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      s.id,
      -- dense_rank, not rank: two students tied on 412 solved are both 5th and the
      -- next is 6th, rather than 7th. Gaps read as a bug to anyone comparing two
      -- cohorts side by side.
      dense_rank() over (order by coalesce(st.total_solved, 0) desc)::int as r
    from public.students s
    left join public.student_stats st on st.student_id = s.id
  )
  select
    ranked.id,
    ranked.r,
    (select max(r) from ranked)::int
  from ranked
  where ranked.id = any(p_student_ids);
$$;

grant execute on function public.student_college_ranks(uuid[]) to service_role;
