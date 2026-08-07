-- Migration: add the 'ceo' role.
--
-- ALONE IN ITS OWN FILE ON PURPOSE. Postgres runs each migration in a
-- transaction, and while `ALTER TYPE ... ADD VALUE` is allowed inside one, the
-- new value cannot be *referenced* until that transaction commits. Putting the
-- enum change and the policies that mention 'ceo' in one file fails with
-- "unsafe use of new value of enum type".
--
-- 20260808000007 creates the colleges, assignments and access rules that use it.

alter type public.app_role add value if not exists 'ceo';
