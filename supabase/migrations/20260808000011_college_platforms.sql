-- Migration: which platforms a college is allowed to use.
--
-- Re-runnable: `create table if not exists`, `create or replace`, and
-- `drop policy if exists` before each `create policy`. No seeding, no backfill.
--
-- Until now platform availability was a single global axis: `platforms.enabled`
-- AND an entry in the TypeScript adapter registry, intersected in
-- refreshablePlatformIds(). That is the right switch for "we have not proven
-- this adapter out yet", but it cannot express "CMRTC runs LeetCode and
-- Codeforces, the other campus also runs CodeChef" — and with more than one
-- college in the table that is the question an admin actually has.
--
-- ── The default is the important part ───────────────────────────────────────
-- A row here is an OVERRIDE, not a grant. Absence means "inherit the global
-- flag", so:
--
--     effective = platforms.enabled AND NOT (an explicit allowed=false row)
--
-- With zero rows in this table the whole system behaves EXACTLY as it does
-- today. That makes this migration a pure addition — nothing to backfill, no
-- college silently losing its platforms on deploy, and a college created later
-- works immediately instead of starting with nothing. Global stays the master
-- kill switch: a platform switched off globally is off everywhere, and no
-- per-college row can turn it back on.
--
-- ── What a denial does ─────────────────────────────────────────────────────
-- Existing handles are KEPT, never deleted — losing a student's account history
-- because an admin flipped a switch is not recoverable. They simply stop being
-- fetched: platform_account_page below is the single funnel every refresh goes
-- through, so filtering there stops the worker without touching a row.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. college_platforms
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.college_platforms (
  college_id  uuid    not null references public.colleges(id)  on delete cascade,
  platform_id text    not null references public.platforms(id) on delete cascade,
  allowed     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (college_id, platform_id)
);

comment on table public.college_platforms is
  'Per-college overrides for platform availability. A row is an override, not a grant: absence means inherit platforms.enabled. Only allowed=false is meaningful.';
comment on column public.college_platforms.allowed is
  'false denies this platform for this college. true is the same as having no row, and is stored so the UI can show an explicit decision.';

-- The lookup below is always (college_id, platform_id), which the primary key
-- already serves. The reverse direction is needed by the worker's per-account
-- check, which arrives knowing the platform and hunting for denials.
create index if not exists college_platforms_platform_idx
  on public.college_platforms (platform_id)
  where not allowed;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. college_allows_platform — one definition of the rule
-- ════════════════════════════════════════════════════════════════════════════

-- Kept as a function rather than inlined so the views, the RPC and anything
-- added later cannot drift into three subtly different readings of "allowed".
create or replace function public.college_allows_platform(_college uuid, _platform text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.college_platforms cp
    where cp.college_id  = _college
      and cp.platform_id = _platform
      and not cp.allowed
  );
$$;

comment on function public.college_allows_platform(uuid, text) is
  'True unless the college has an explicit allowed=false override. Absence of a row means allowed, so a fresh install and a new college both behave as before.';

grant execute on function public.college_allows_platform(uuid, text)
  to service_role, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. platform_account_page — stop fetching denied accounts
-- ════════════════════════════════════════════════════════════════════════════

-- Same signature as 20260808000009_partial_retry.sql, so no type regeneration
-- and no client change. The TTL and partial-retry logic are carried over
-- verbatim; the only addition is the college clause at the end.
--
-- A student with no college (no classroom membership, so no student_colleges
-- row) is never excluded — the join simply finds nothing to deny. That matters:
-- an unassigned student must not silently stop refreshing.
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
    -- The college gate. Written as NOT EXISTS over the denial rather than a
    -- join through college_allows_platform so that a student with no college,
    -- or a college with no overrides, costs nothing and is never filtered out.
    and not exists (
      select 1
      from public.student_colleges sc
      join public.college_platforms cp
        on cp.college_id  = sc.college_id
       and cp.platform_id = a.platform_id
      where sc.student_id = a.student_id
        and not cp.allowed
    )
  order by a.id
  limit greatest(p_limit, 1);
$$;

grant execute on function public.platform_account_page(text, uuid, int, int, text, uuid, uuid[], timestamptz)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. RLS
-- ════════════════════════════════════════════════════════════════════════════

-- Reads are open to signed-in staff: the add-student form and the bulk-upload
-- preview both need to know which platforms a college accepts before they can
-- render the right fields. Writes are service_role only, matching platforms —
-- the real enforcement is requireRole("admin") on the server function, and the
-- policy below is defence in depth.
alter table public.college_platforms enable row level security;

drop policy if exists "college_platforms readable by authenticated" on public.college_platforms;
create policy "college_platforms readable by authenticated"
  on public.college_platforms for select
  to authenticated
  using (true);

drop policy if exists "college_platforms admin write" on public.college_platforms;
create policy "college_platforms admin write"
  on public.college_platforms for all
  to authenticated
  using (has_role(auth.uid(), 'admin'))
  with check (has_role(auth.uid(), 'admin'));

grant select on public.college_platforms to authenticated;
grant select, insert, update, delete on public.college_platforms to service_role;
