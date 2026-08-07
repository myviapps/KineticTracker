-- Migration: config for the five adapters that just landed.
--
-- Re-runnable: plain UPDATEs against known ids, no schema change.
--
-- 20260808000001 registered these platforms as configurable SLOTS ahead of
-- their adapters — "turning one on is a boolean flip once its adapter lands".
-- The adapters have now landed, so this is that flip, plus two corrections the
-- adapters exposed.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. interviewbit ranks on SCORE, not solved
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20260808000008 gave every unlisted platform the default rank_metric 'solved'.
-- That was a reasonable guess before anyone had read the page; the adapter has
-- now established it is wrong.
--
-- An InterviewBit profile shows a score, a global rank and a streak. It shows
-- per-topic progress bars but no attributable total solve count, so the adapter
-- deliberately leaves total_solved unset rather than substituting the score for
-- it. With rank_metric = 'solved' the ranking window function would therefore
-- order every InterviewBit account on NULL — the platform would appear in the
-- UI, collect handles, fetch fine, and rank nobody.
update public.platforms set rank_metric = 'score' where id = 'interviewbit';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. atcoder is a rating ladder
-- ════════════════════════════════════════════════════════════════════════════
--
-- Already set by 20260808000008 alongside codeforces and codechef. Restated
-- idempotently so this migration is self-contained if that one is ever squashed.
update public.platforms set rank_metric = 'rating' where id = 'atcoder';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Pacing for the rendered platforms
-- ════════════════════════════════════════════════════════════════════════════
--
-- hackerearth, interviewbit, code360 and spoj go through the render sidecar,
-- where one "request" is a real browser page-load — seconds, not milliseconds,
-- and a Cloudflare solve is slower still. The defaults copied from the HTML
-- scrapers assume a cheap GET and would have a chunk plan far more work than it
-- can finish, so every job would burn its budget mid-batch.
--
-- Smaller batches, longer cooldowns, and an est_batch_ms that tells the worker's
-- admission test the truth up front instead of making it learn on batch one.
update public.platforms
   set batch_size = 3,
       base_cooldown_ms = 5000,
       est_batch_ms = 30000,
       max_concurrency = 1
 where id in ('hackerearth', 'interviewbit', 'code360');

-- SPOJ is the slowest of the four: every fetch pays for a Cloudflare challenge,
-- and Scrapling silently raises any sub-60s timeout to 60s on that path, so a
-- single solve can approach the WHOLE 50s chunk budget the worker allocates.
--
-- batch_size 1 is therefore arithmetic, not caution: two accounts cannot both
-- finish, and a batch that always runs out of budget half-done makes no forward
-- progress at all — the same accounts get retried every chunk while the ones
-- behind them are never reached.
update public.platforms
   set batch_size = 1,
       base_cooldown_ms = 8000,
       est_batch_ms = 45000,
       max_concurrency = 1
 where id = 'spoj';

-- AtCoder is two plain JSON calls, so it keeps ordinary pacing. Their published
-- policy asks for a descriptive User-Agent rather than a particular rate; the
-- adapter sends one.
update public.platforms
   set batch_size = 5,
       base_cooldown_ms = 1200,
       est_batch_ms = 12000
 where id = 'atcoder';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. NOT enabling anything
-- ════════════════════════════════════════════════════════════════════════════
--
-- `enabled` is deliberately untouched. Four of these five cannot work until
-- SCRAPLING_URL points at a running render sidecar, and enabling them here would
-- queue jobs that fail on every account, trip the circuit breaker and fill
-- Scrape History with noise that looks like broken handles.
--
-- Turn them on from the Platforms page once the sidecar is up — that screen
-- exists for exactly this, and doing it there means one platform at a time with
-- the health numbers in view. AtCoder needs no sidecar and can go on now.
