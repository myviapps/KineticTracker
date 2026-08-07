-- Migration: platform registry — the one place that knows a coding platform exists.
--
-- Re-runnable: every statement is `if not exists` / `or replace` / `on conflict
-- do nothing`, so applying this twice is a no-op rather than an error.
--
-- PHASE 1 of 2, and entirely ADDITIVE. Nothing reads this table yet. The LeetCode
-- pipeline keeps running against students.leetcode_id and student_stats exactly
-- as before, so this can be applied to production ahead of the code that uses it
-- and rolling the deploy back is a `git revert` rather than a database restore.
--
-- Tuning lives in COLUMNS, not in TypeScript. Cooldowns, batch sizes, TTLs and
-- scoring weights are all learnable only in production — Codeforces documents
-- 1 req/2s, CodeChef and HackerRank sit behind Cloudflare, and GeeksforGeeks
-- rewrites its front end regularly. Keeping them here makes retuning an admin-UI
-- change instead of a redeploy, which matters when a platform starts throttling
-- at 2am.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Registry
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.platforms (
  id                    text primary key,          -- 'leetcode', 'codeforces', …
  name                  text not null,
  tier                  text not null check (tier in ('api', 'json', 'html')),
  profile_url_template  text not null,             -- 'https://…/{handle}'
  enabled               boolean not null default false,

  -- ── ingestion tuning ──────────────────────────────────────────────────────
  batch_size            int  not null default 5,
  base_cooldown_ms      int  not null default 3000,
  -- Seed for the worker's batch-duration estimator. The worker measures the real
  -- figure per chunk and admits batches off the measurement; this only has to be
  -- close enough for the FIRST batch of a cold job.
  est_batch_ms          int  not null default 12000,
  -- Skip accounts fetched more recently than this. The cheapest possible defence
  -- against rate limits is simply not making the request.
  refresh_ttl_hours     int  not null default 24,
  -- Mirrors the per-platform semaphores in the reference implementation: a global
  -- worker count says nothing about how hard ONE site is being hit.
  max_concurrency       int  not null default 3,
  -- Codeforces' user.info accepts ~100 semicolon-separated handles in a single
  -- request, which turns a whole college into a handful of calls.
  supports_batch_fetch  boolean not null default false,

  -- ── scoring weights (the difficulty-weighted composite) ───────────────────
  -- Per-platform on purpose: a GeeksforGeeks "Easy" and a Codeforces 800 are not
  -- the same achievement, and a single global weight set would quietly reward
  -- whichever platform hands out the most cheap problems.
  weight_easy           numeric not null default 1,
  weight_medium         numeric not null default 3,
  weight_hard           numeric not null default 5,
  weight_unrated        numeric not null default 2,   -- platforms with no difficulty split
  -- score += max(0, (rating - rating_baseline) / 100) * rating_weight
  rating_baseline       numeric,
  rating_weight         numeric not null default 0,

  -- ── health / meta ─────────────────────────────────────────────────────────
  -- Bump when an adapter's parsing changes, so a stats row can be traced to the
  -- code that produced it after a site redesign.
  adapter_version       int  not null default 1,
  sort_order            int  not null default 100,
  notes                 text,
  created_at            timestamptz not null default now()
);

comment on table public.platforms is
  'Coding-platform registry: ingestion tuning and scoring weights, editable from the admin UI without a deploy.';
comment on column public.platforms.tier is
  'api = documented public API; json = undocumented but machine-readable JSON; html = DOM/regex scrape. Higher tiers break more often.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Seed
-- ════════════════════════════════════════════════════════════════════════════
--
-- Only LeetCode ships enabled — it is the one with a working adapter today.
-- Every other row is a registered SLOT: the schema, weights and tuning are in
-- place so turning one on is a boolean flip once its adapter lands, and a
-- platform that starts failing can be switched off without a deploy.
--
-- Endpoints and field availability below were verified against live responses,
-- not taken from documentation.

insert into public.platforms (
  id, name, tier, profile_url_template, enabled,
  batch_size, base_cooldown_ms, est_batch_ms, refresh_ttl_hours, max_concurrency, supports_batch_fetch,
  weight_easy, weight_medium, weight_hard, weight_unrated, rating_baseline, rating_weight,
  sort_order, notes
) values
  -- ── Tier A: documented APIs ───────────────────────────────────────────────
  ('leetcode', 'LeetCode', 'api', 'https://leetcode.com/u/{handle}/', true,
   5, 3000, 12000, 24, 3, false,
   1, 3, 5, 2, null, 0,
   10, 'GraphQL. Full difficulty split, submission calendar, tag/language stats, contest rating.'),

  ('codeforces', 'Codeforces', 'api', 'https://codeforces.com/profile/{handle}', false,
   20, 2100, 15000, 24, 1, true,
   1, 3, 5, 2, 800, 15,
   20, 'Official API. 1 req/2s. user.info takes ~100 handles at once. total_solved must be DERIVED from user.status (no direct field); difficulty comes from problemset.problems, fetched once globally and cached. user.info.rank is a TITLE ("legendary grandmaster"), not a number.'),

  ('atcoder', 'AtCoder', 'api', 'https://atcoder.jp/users/{handle}', false,
   5, 1200, 12000, 24, 2, false,
   1, 3, 5, 2, 400, 10,
   30, 'atcoder.jp/users/{h}/history/json for rating history; kenkoooo ac_rank gives {count, rank} cheaply. No difficulty split without the 4.4MB problem-metadata dump. Their policy asks for a descriptive User-Agent.'),

  ('kaggle', 'Kaggle', 'api', 'https://www.kaggle.com/{handle}', false,
   5, 2000, 12000, 168, 2, false,
   0, 0, 0, 0, null, 0,
   110, 'DISABLED BY DESIGN: yields competition/notebook medals, not solved problems. All weights are 0 so it can never distort the difficulty-weighted composite. Needs KAGGLE_USERNAME/KAGGLE_KEY.'),

  -- ── Tier B: undocumented but machine-readable ─────────────────────────────
  ('geeksforgeeks', 'GeeksforGeeks', 'json', 'https://www.geeksforgeeks.org/user/{handle}/', false,
   5, 3000, 15000, 48, 3, false,
   0.5, 2, 4, 0.5, null, 0,
   40, 'Use /gfg-assets/_next/data/latest/user/{h}.json — structured userInfo, userSubmissionsInfo, heatMapData, lineChartData, contestData. authapi.geeksforgeeks.org/api-get/user-profile-info/?handle= is a lighter fallback. There is NO __NEXT_DATA__ blob. Weights are deliberately low: School/Basic tiers inflate raw counts.'),

  ('hackerrank', 'HackerRank', 'json', 'https://www.hackerrank.com/profile/{handle}', false,
   5, 3000, 15000, 48, 3, false,
   1, 3, 5, 1, null, 0,
   50, 'Profile is /rest/contests/master/hackers/{h}/profile — /rest/hackers/{h}/profile 404s. total_solved = SUM of /rest/hackers/{h}/badges models[].solved; the profile model has no solved_challenges field. scores_elo gives 20 per-track practice/contest scores and ranks. No difficulty split, hence weight_unrated.'),

  ('codechef', 'CodeChef', 'html', 'https://www.codechef.com/users/{handle}', false,
   5, 4000, 18000, 24, 2, false,
   1, 3, 5, 2, 1000, 12,
   60, 'HTML behind Cloudflare. rating via .rating-number, stars via .rating-star, full rating history from the inline `var all_rating = [...]` JS array. No difficulty split.'),

  -- ── Tier C: HTML scrape, thin data, high maintenance ──────────────────────
  ('hackerearth', 'HackerEarth', 'html', 'https://www.hackerearth.com/@{handle}', false,
   5, 4000, 18000, 72, 2, false,
   1, 3, 5, 1.5, null, 0,
   70, 'Mostly JS-rendered; only a weak problems-solved count is reliably extractable.'),

  ('spoj', 'SPOJ', 'html', 'https://www.spoj.com/users/{handle}/', false,
   5, 5000, 20000, 168, 1, false,
   1, 3, 5, 2, null, 0,
   80, 'BLOCKED: returns 403 with a Cloudflare bot challenge even from a residential IP. Needs a proxy before it can be enabled at all.'),

  ('interviewbit', 'InterviewBit', 'html', 'https://www.interviewbit.com/profile/{handle}', false,
   5, 4000, 18000, 168, 2, false,
   1, 3, 5, 1.5, null, 0,
   90, 'Score/rank/streak only, JS-rendered.'),

  ('code360', 'Code360 (Coding Ninjas)', 'html', 'https://www.naukri.com/code360/profile/{handle}', false,
   5, 4000, 18000, 168, 2, false,
   1, 3, 5, 1.5, null, 0,
   100, 'Most fragile: the public API is keyed on an opaque uuid, so each handle needs a discovery step first.')
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Platform config is not personal data — every signed-in user and the public
-- student page need to read it to render names, links and icons. Writes stay
-- service-role only, like every other write in this app.

alter table public.platforms enable row level security;

drop policy if exists "platforms readable by all" on public.platforms;
create policy "platforms readable by all"
  on public.platforms for select
  to anon, authenticated
  using (true);

grant select on public.platforms to anon, authenticated;
