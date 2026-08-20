-- Migration: stop destroying the case of a LeetCode handle.
--
-- Re-runnable: `or replace` / `if not exists` / guarded DO blocks throughout.
--
-- ── What was broken ────────────────────────────────────────────────────────
-- Every write path ran students.leetcode_id through a lower-casing normalizer,
-- because students.leetcode_id carries a case-SENSITIVE unique index and
-- folding the value was the cheapest way to stop `Priya_N` and `priya_n`
-- becoming two students pointing at one profile.
--
-- LeetCode's own lookup is case-SENSITIVE. So the normalizer was rewriting
-- correct handles into ones that do not exist: the scraper failed with "That
-- user does not exist" forever, and the edit form could not repair it — retyping
-- the right casing normalized straight back to the broken value, the server saw
-- no change, wrote the old value back, and reported success. Ten students were
-- parked that way, at consecutive_failures = 5.
--
-- The app now stores the handle exactly as typed (see normalizeHandle in
-- students.functions.ts). This migration supplies the two things the database
-- has to do for that to be safe.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Uniqueness moves from "same bytes" to "same profile"
-- ════════════════════════════════════════════════════════════════════════════
--
-- The existing case-sensitive unique index stays: it is what PostgREST infers
-- an on_conflict target against. This one adds back, honestly, the guarantee
-- lower-casing was providing by side effect.
--
-- Pre-flight raises rather than warns. Everywhere else in this schema a
-- conflict is reported and skipped, because the fallback is safe; here there is
-- no safe fallback — an index that cannot be built leaves two students sharing
-- one profile with nothing to stop a third. Failing loudly with the offending
-- handles named is the actionable outcome.
do $$
declare v_report text;
begin
  select string_agg(distinct lower(trim(leetcode_id)), ', ')
    into v_report
  from public.students
  where leetcode_id is not null and trim(leetcode_id) <> ''
  group by lower(trim(leetcode_id))
  having count(*) > 1;

  if v_report is not null then
    raise exception
      'Cannot enforce case-insensitive LeetCode handles: these are held by more than one student: %. Merge them under Scrape History -> Duplicates, then re-run this migration.',
      v_report;
  end if;
end $$;

create unique index if not exists students_leetcode_id_lower_key
  on public.students (lower(trim(leetcode_id)));

comment on index public.students_leetcode_id_lower_key is
  'One student, one LeetCode profile — case-insensitively. Replaces the app-side lower-casing that used to corrupt handles to achieve this.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. A case-only correction has to reach the account row
-- ════════════════════════════════════════════════════════════════════════════
--
-- The sync trigger compared lower(old) to lower(new) and treated a case-only
-- edit as "no change" — which was correct while the app could never produce
-- one, and is exactly backwards now that fixing the case IS the repair. Left
-- alone, `suryateja_79` -> `Suryateja_79` would update students.leetcode_id and
-- leave the multi-platform worker fetching the old, broken casing from
-- student_platform_accounts.handle forever.
--
-- The comparison is now exact, so any textual difference propagates AND clears
-- the fetch state: on a case-sensitive platform a different case is a different
-- lookup, so the failure count and last error belong to a profile we were never
-- really asking for.

create or replace function public.sync_leetcode_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_handle text;
begin
  if new.leetcode_id is null or trim(new.leetcode_id) = '' then
    delete from public.student_platform_accounts
     where student_id = new.id and platform_id = 'leetcode';
    return new;
  end if;

  select handle into v_old_handle
    from public.student_platform_accounts
   where student_id = new.id and platform_id = 'leetcode';

  if v_old_handle is null then
    insert into public.student_platform_accounts (student_id, platform_id, handle, status)
    values (new.id, 'leetcode', new.leetcode_id, 'unverified');

  -- Exact compare, NOT lower(): a case-only fix is a real fix.
  elsif v_old_handle is distinct from new.leetcode_id then
    update public.student_platform_accounts
       set handle               = new.leetcode_id,
           status               = 'unverified',
           consecutive_failures = 0,
           fetch_error          = null,
           verified_at          = null
     where student_id = new.id and platform_id = 'leetcode';
  end if;

  return new;
exception
  when unique_violation then
    raise warning
      'student_platform_accounts: LeetCode handle "%" is already claimed by another student (case-insensitive). Student % was not synced.',
      new.leetcode_id, new.id;
    return new;
end $$;

-- Unchanged definition, restated so the trigger cannot be left pointing at a
-- dropped function if this file is applied to a database that never had it.
drop trigger if exists students_sync_leetcode_account on public.students;
create trigger students_sync_leetcode_account
  after insert or update of leetcode_id on public.students
  for each row execute function public.sync_leetcode_account();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Give the parked students one more chance
-- ════════════════════════════════════════════════════════════════════════════
--
-- Handles that hit the failure cutoff are excluded from the worker's scan index
-- entirely, so they would stay invisible even after someone corrects the case.
-- Nothing is invented here: the counter is cleared only for accounts whose
-- error was the platform saying the user does not exist, which is precisely the
-- symptom the lower-casing produced. A genuinely wrong handle simply fails
-- again and re-parks itself.

update public.student_platform_accounts
   set status               = 'unverified',
       consecutive_failures = 0
 where platform_id = 'leetcode'
   and status = 'invalid_handle';

update public.students
   set consecutive_failures = 0
 where scrape_error ilike '%does not exist%';
