-- Standing inside the institution: college rank, and rank within each cohort.
--
-- The students table already surfaced a `rank`, but that is LeetCode's WORLDWIDE
-- ranking off the scraped profile — nothing to do with standing here, and
-- mislabelled as "Rank" in the classroom table.
--
-- Both ranks are computed in Postgres rather than the browser because both depend
-- on rows the caller does not hold: college rank needs every student in the
-- platform, and the profile page has no roster at all. Pulling either to the
-- client would hit PostgREST's row cap and hand out the whole directory.
--
-- Re-runnable.

create or replace function public.student_ranks(p_student_ids uuid[])
returns table (
  student_id uuid,
  college_rank int,
  college_total int,
  classroom_ranks jsonb   -- [{classroom_id, classroom_name, rank, total}]
)
language sql
stable
security definer
set search_path = public
as $$
  with solved as (
    select s.id, coalesce(st.total_solved, 0) as total
    from public.students s
    left join public.student_stats st on st.student_id = s.id
  ),
  college as (
    -- dense_rank, not rank: two students tied on 412 solved are both 5th and the
    -- next is 6th rather than 7th. Gaps read as a bug when you compare two cohorts.
    select
      id,
      dense_rank() over (order by total desc)::int as r,
      -- The denominator is a HEADCOUNT, not a count of distinct scores: "#3 of 45"
      -- means 45 students. (It also has to be a plain window count — Postgres has
      -- no count(distinct ...) over (...).)
      count(*) over ()::int as n
    from solved
  ),
  per_class as (
    select
      cs.student_id,
      cs.classroom_id,
      c.name as classroom_name,
      dense_rank() over (partition by cs.classroom_id order by sv.total desc)::int as r,
      count(*) over (partition by cs.classroom_id)::int as n
    from public.classroom_students cs
    join public.classrooms c on c.id = cs.classroom_id
    join solved sv on sv.id = cs.student_id
  )
  select
    col.id,
    col.r,
    col.n,
    coalesce(
      (select jsonb_agg(jsonb_build_object(
         'classroom_id', pc.classroom_id,
         'classroom_name', pc.classroom_name,
         'rank', pc.r,
         'total', pc.n
       ) order by pc.classroom_name)
       from per_class pc where pc.student_id = col.id),
      '[]'::jsonb)
  from college col
  where col.id = any(p_student_ids);
$$;

grant execute on function public.student_ranks(uuid[]) to service_role;
