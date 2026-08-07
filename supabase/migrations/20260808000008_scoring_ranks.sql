-- Migration: the Almanac Score, and ranks that understand colleges + platforms.
--
-- Re-runnable: `or replace` / `if not exists` throughout.
--
-- Three problems with ranking as it stands:
--   1. It ranks on student_stats.total_solved — LeetCode only. A student who
--      lives on Codeforces reads as a beginner.
--   2. "College rank" means "rank against every row in the students table",
--      which stops being true the moment a second college exists.
--   3. There is no per-platform standing at all.
--
-- student_ranks_v2 is a NEW function rather than a replacement: Postgres cannot
-- `create or replace` a function whose return type changed, so replacing would
-- mean drop-then-create and a window where the deployed app calls a function
-- that does not exist. The old student_ranks stays until nothing calls it.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. How each platform is ranked
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ranking Codeforces by problems solved would be wrong — a 1900-rated
-- competitor with 300 solves outranks a 900-rated one with 900. Which metric is
-- meaningful is a property of the platform, so it lives in the platform row.

alter table public.platforms
  add column if not exists rank_metric text not null default 'solved';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platforms_rank_metric_check'
  ) then
    alter table public.platforms
      add constraint platforms_rank_metric_check
      check (rank_metric in ('solved', 'rating', 'score'));
  end if;
end $$;

update public.platforms set rank_metric = 'rating'
 where id in ('codeforces', 'codechef', 'atcoder');
update public.platforms set rank_metric = 'score'
 where id in ('geeksforgeeks', 'hackerrank');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The Almanac Score
-- ════════════════════════════════════════════════════════════════════════════
--
--   Σ over the student's accounts:
--       easy·w_easy + medium·w_medium + hard·w_hard + unrated·w_unrated
--     + max(0, (rating - baseline) / 100) · w_rating
--
-- Every coefficient is a column on `platforms`, so calibrating this is an admin
-- edit rather than a deploy. That matters because the weights are the only thing
-- standing between "difficulty-weighted" and "whoever ground the most
-- GeeksforGeeks School problems wins" — GFG ships with w_easy 0.5 and a low
-- w_unrated for exactly that reason.
--
-- EVERY student appears, including those with no accounts (score 0), so the rank
-- denominator is a true headcount. That matches the convention the original
-- student_ranks already documented: "#3 of 45" means 45 students, not 45
-- distinct scores.

create or replace view public.student_scores as
with per_account as (
  select
    ps.student_id,
    ps.platform_id,
    coalesce(ps.easy_solved, 0)    * p.weight_easy
  + coalesce(ps.medium_solved, 0)  * p.weight_medium
  + coalesce(ps.hard_solved, 0)    * p.weight_hard
  + coalesce(ps.unrated_solved, 0) * p.weight_unrated
  + case
      when p.rating_baseline is not null and ps.rating is not null
        then greatest(0, (ps.rating - p.rating_baseline) / 100.0) * p.rating_weight
      else 0
    end as contribution
  from public.platform_stats ps
  join public.platforms p on p.id = ps.platform_id
  where p.enabled
)
select
  s.id as student_id,
  round(coalesce(sum(pa.contribution), 0), 2) as almanac_score,
  count(pa.platform_id)::int                  as platform_count,
  coalesce(
    jsonb_object_agg(pa.platform_id, round(pa.contribution, 2))
      filter (where pa.platform_id is not null),
    '{}'::jsonb
  ) as score_breakdown
from public.students s
left join per_account pa on pa.student_id = s.id
group by s.id;

comment on view public.student_scores is
  'Difficulty-weighted cross-platform score. Weights live in platforms.* so they are tunable without a deploy.';

grant select on public.student_scores to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. student_ranks_v2
-- ════════════════════════════════════════════════════════════════════════════
--
-- dense_rank, not rank: two students tied on 412 are both 5th and the next is
-- 6th. Gaps read as a bug when two cohorts are compared side by side.
--
-- Both college and overall ranks are returned, because a student wants "#3 in
-- CMRTC" and a CEO comparing campuses wants "#41 across all colleges", and
-- neither can be computed from the other.
--
-- Per-platform ranks are computed ONLY among students who actually have an
-- account on that platform. "#4 of 31 on Codeforces" is then a true statement
-- about the 31 who compete there, instead of burying a competitor behind 300
-- classmates who have never opened the site.

create or replace function public.student_ranks_v2(p_student_ids uuid[])
returns table (
  student_id      uuid,
  almanac_score   numeric,
  score_breakdown jsonb,
  college_id      uuid,
  college_name    text,
  college_rank    int,
  college_total   int,
  overall_rank    int,
  overall_total   int,
  classroom_ranks jsonb,
  platform_ranks  jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with scored as (
    select
      sc.student_id,
      sc.almanac_score,
      sc.score_breakdown,
      col.college_id,
      col.college_name
    from public.student_scores sc
    left join public.student_colleges col on col.student_id = sc.student_id
  ),
  ranked as (
    select
      s.*,
      dense_rank() over (order by s.almanac_score desc)::int as overall_r,
      count(*)     over ()::int                              as overall_n,
      dense_rank() over (partition by s.college_id order by s.almanac_score desc)::int as college_r,
      count(*)     over (partition by s.college_id)::int                               as college_n
    from scored s
  ),
  per_class as (
    select
      cs.student_id,
      cs.classroom_id,
      c.name as classroom_name,
      dense_rank() over (partition by cs.classroom_id order by sc.almanac_score desc)::int as r,
      count(*)     over (partition by cs.classroom_id)::int                                as n
    from public.classroom_students cs
    join public.classrooms c  on c.id = cs.classroom_id
    join public.student_scores sc on sc.student_id = cs.student_id
  ),
  per_platform as (
    select
      ps.student_id,
      ps.platform_id,
      p.name as platform_name,
      p.rank_metric,
      -- The number this platform is ranked on, chosen by its own rank_metric.
      case p.rank_metric
        when 'rating' then ps.rating
        when 'score'  then ps.platform_score
        else               ps.total_solved::numeric
      end as metric_value,
      col.college_id,
      dense_rank() over (
        partition by ps.platform_id, col.college_id
        order by (case p.rank_metric
                    when 'rating' then ps.rating
                    when 'score'  then ps.platform_score
                    else               ps.total_solved::numeric
                  end) desc nulls last
      )::int as college_r,
      count(*) over (partition by ps.platform_id, col.college_id)::int as college_n,
      dense_rank() over (
        partition by ps.platform_id
        order by (case p.rank_metric
                    when 'rating' then ps.rating
                    when 'score'  then ps.platform_score
                    else               ps.total_solved::numeric
                  end) desc nulls last
      )::int as overall_r,
      count(*) over (partition by ps.platform_id)::int as overall_n
    from public.platform_stats ps
    join public.platforms p on p.id = ps.platform_id and p.enabled
    left join public.student_colleges col on col.student_id = ps.student_id
  )
  select
    r.student_id,
    r.almanac_score,
    r.score_breakdown,
    r.college_id,
    r.college_name,
    r.college_r,
    r.college_n,
    r.overall_r,
    r.overall_n,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'classroom_id',   pc.classroom_id,
               'classroom_name', pc.classroom_name,
               'rank',           pc.r,
               'total',          pc.n
             ) order by pc.classroom_name)
      from per_class pc where pc.student_id = r.student_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform_id',   pp.platform_id,
               'platform_name', pp.platform_name,
               'metric',        pp.rank_metric,
               'value',         pp.metric_value,
               'college_rank',  pp.college_r,
               'college_total', pp.college_n,
               'overall_rank',  pp.overall_r,
               'overall_total', pp.overall_n
             ) order by pp.platform_name)
      from per_platform pp where pp.student_id = r.student_id
    ), '[]'::jsonb)
  from ranked r
  where r.student_id = any(p_student_ids);
$$;

grant execute on function public.student_ranks_v2(uuid[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. College-level rollup, for the CEO views
-- ════════════════════════════════════════════════════════════════════════════
--
-- One row per college: the aggregate a CEO compares campuses on. Kept as a view
-- so "overall across my colleges" is a SUM over rows the caller can already see,
-- rather than a second query with its own access rules to get wrong.

create or replace view public.college_overview as
select
  col.id   as college_id,
  col.name as college_name,
  col.slug as college_slug,
  count(distinct cs.student_id)::int                        as student_count,
  count(distinct c.id)::int                                 as classroom_count,
  coalesce(round(avg(sc.almanac_score), 2), 0)              as avg_score,
  coalesce(round(sum(sc.almanac_score), 2), 0)              as total_score,
  coalesce(sum(ps.total_solved), 0)::bigint                 as total_solved,
  count(distinct ps.platform_id)::int                       as platforms_in_use
from public.colleges col
left join public.classrooms c          on c.college_id = col.id
left join public.classroom_students cs on cs.classroom_id = c.id
left join public.student_scores sc     on sc.student_id = cs.student_id
left join public.platform_stats ps     on ps.student_id = cs.student_id
group by col.id, col.name, col.slug;

comment on view public.college_overview is
  'Per-college rollup for the CEO dashboard. Filter by has_college_access for the "my colleges" view.';

grant select on public.college_overview to authenticated;
