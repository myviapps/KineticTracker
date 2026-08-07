-- Per-IP token bucket for the unauthenticated endpoints (M-3).
--
-- Backs src/lib/rate-limit.server.ts. State lives here rather than in module
-- memory because the app runs on Vercel serverless — an in-process Map is
-- per-instance, resets on cold start, and an attacker spreading requests across
-- instances would never hit it.
--
-- `bucket` is "<kind>:<truncated sha256 of client ip>". The IP is never stored in
-- the clear: the limiter needs to recognise a repeat caller, not identify one.

create table if not exists public.rate_limits (
  bucket      text primary key,
  tokens      real        not null,
  refilled_at timestamptz not null default now()
);

-- Supports the pruning query below.
create index if not exists rate_limits_refilled_at_idx
  on public.rate_limits (refilled_at);

-- Service-role only. This table is never reachable from a browser: the limiter
-- runs inside server functions, and letting a caller read or write their own
-- bucket would defeat the point.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

drop policy if exists "rate_limits service only" on public.rate_limits;
create policy "rate_limits service only" on public.rate_limits for all using (false);

-- ────────────────────────────────────────────────────────────────────────────
-- Atomic take-one-token.
--
-- Returns true if a token was available (request allowed), false otherwise.
--
-- Atomicity note: the INSERT ... ON CONFLICT DO UPDATE takes a row lock that is
-- held for the rest of the transaction, and a function body runs in one
-- transaction. So the refill and the decrement below cannot interleave with a
-- concurrent caller on the same bucket — the second caller blocks on the lock.
--
-- Tokens are only deducted when the request is actually allowed, so a sustained
-- flood cannot drive the balance arbitrarily negative and lock a bucket out for
-- longer than the refill rate implies.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_limit_take(
  _bucket        text,
  _capacity      real,
  _refill_per_sec real
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _now     timestamptz := now();
  _tokens  real;
begin
  insert into public.rate_limits as rl (bucket, tokens, refilled_at)
  values (_bucket, _capacity, _now)
  on conflict (bucket) do update
    set tokens = least(
          _capacity,
          rl.tokens + extract(epoch from (_now - rl.refilled_at))::real * _refill_per_sec
        ),
        refilled_at = _now
  returning rl.tokens into _tokens;

  if _tokens < 1 then
    return false;
  end if;

  update public.rate_limits set tokens = _tokens - 1 where bucket = _bucket;
  return true;
end;
$$;

revoke execute on function public.rate_limit_take(text, real, real) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, real, real) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Pruning. A bucket that has not been touched in a day is at full capacity by
-- definition, so deleting it is indistinguishable from keeping it. Called from
-- the daily cron so the table does not grow without bound.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_limit_prune()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  delete from public.rate_limits where refilled_at < now() - interval '1 day';
  get diagnostics _deleted = row_count;
  return _deleted;
end;
$$;

revoke execute on function public.rate_limit_prune() from public, anon, authenticated;
grant execute on function public.rate_limit_prune() to service_role;
