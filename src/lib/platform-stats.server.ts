// Server-only: persist one adapter result for one (student, platform) account.
//
// This is the counterpart to scrape.server.ts, which stays as the LeetCode-only
// path until the worker cuts over. Everything that decides WHAT a fetch meant —
// whether a handle is dead, whether a count is trustworthy, whether a failure is
// the student's fault — lives here rather than in the adapters, so an adapter
// stays a pure function of an HTTP response.

import type { Json } from "@/integrations/supabase/types";
import type { NormalizedProfile } from "./platforms/types";
import { PlatformError } from "./platforms/types";

/** How many consecutive failures before a handle stops costing us requests. */
export const ACCOUNT_FAILURE_CUTOFF = 5;

export type PersistTarget = {
  accountId: string;
  studentId: string;
  platformId: string;
  handle: string;
};

/**
 * Columns the adapter actually spoke to.
 *
 * `undefined` means "this platform does not report this field, or we did not
 * fetch it this run" and MUST be omitted from the update — writing it would
 * blank a real value. `null` means the platform reported nothing, which is a
 * legitimate value to store. That distinction is the whole reason this builds an
 * object instead of spreading the profile.
 */
function definedColumns(p: NormalizedProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (col: string, v: unknown) => {
    if (v !== undefined) out[col] = v;
  };

  put("display_name", p.displayName);
  put("avatar", p.avatar);
  put("country", p.country);
  put("total_solved", p.totalSolved);
  put("easy_solved", p.easySolved);
  put("medium_solved", p.mediumSolved);
  put("hard_solved", p.hardSolved);
  put("unrated_solved", p.unratedSolved);
  put("rating", p.rating);
  put("max_rating", p.maxRating);
  put("global_rank", p.globalRank);
  put("country_rank", p.countryRank);
  put("institute_rank", p.instituteRank);
  put("platform_score", p.platformScore);
  put("stars", p.stars);
  put("streak", p.streak);
  put("contests_attended", p.contestsAttended);

  return out;
}

/**
 * Reject a payload that would destroy history.
 *
 * A broken parser and an empty profile are indistinguishable at the column
 * level: both say "0 solved". The difference is that one of them follows a row
 * that said 412. Adapters raise parse_error when they can tell, but they cannot
 * always tell — a redesign that still yields a well-formed page with the numbers
 * moved will parse "successfully" into zeros.
 *
 * So this is the last line of defence, and it is deliberately about the DELTA
 * rather than the value: solve counts are monotonic in practice, and a real
 * student never loses 30% of their solved problems overnight.
 */
export function isImplausibleRegression(
  next: NormalizedProfile,
  prev: { total_solved: number | null } | null,
): string | null {
  const before = prev?.total_solved ?? null;
  const after = next.totalSolved;

  if (before === null || before <= 0) return null;
  if (after === undefined || after === null) return null; // not fetched — not a regression

  if (after === 0) {
    return `total_solved collapsed ${before} -> 0`;
  }
  if (after < before * 0.7) {
    return `total_solved dropped ${before} -> ${after} (>30%)`;
  }
  return null;
}

export type PersistOutcome =
  | { ok: true; status: "success" | "partial"; totalSolved: number | null }
  | { ok: false; reason: string };

export async function persistPlatformProfile(
  target: PersistTarget,
  profile: NormalizedProfile,
): Promise<PersistOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { log } = await import("./log.server");
  const { accountId, studentId, platformId } = target;

  const { data: prev } = await supabaseAdmin
    .from("platform_stats")
    .select("total_solved, data")
    .eq("account_id", accountId)
    .maybeSingle();

  const regression = isImplausibleRegression(profile, prev);
  if (regression) {
    // Keep the last good row. Recorded as a parse_error against the ACCOUNT so
    // it surfaces on the platform health page as an adapter problem, which is
    // what it almost certainly is — not as a student who stopped solving.
    log.error("persist", `  ⚠ ${platformId}/${target.handle}: refusing write — ${regression}`);
    await supabaseAdmin
      .from("student_platform_accounts")
      .update({
        last_fetched_at: new Date().toISOString(),
        fetch_error: `Implausible data rejected: ${regression}`,
      })
      .eq("id", accountId);
    return { ok: false, reason: regression };
  }

  const cols = definedColumns(profile);
  const status: "success" | "partial" = profile.partial ? "partial" : "success";
  const now = new Date().toISOString();

  const { error: statsError } = await supabaseAdmin.from("platform_stats").upsert(
    {
      account_id: accountId,
      student_id: studentId,
      platform_id: platformId,
      ...cols,
      // MERGED, not replaced. The optional calls are the first thing dropped
      // when a chunk runs short, and LeetCode's adapter still emits
      // submission_calendar as {} in that case — a straight overwrite would
      // erase a year of heatmap data to save two seconds. New keys win; keys
      // this run didn't produce keep their previous value.
      data: {
        ...((prev?.data as Record<string, unknown> | null) ?? {}),
        ...(profile.data ?? {}),
      } as Json,
      fetch_status: status,
      error_msg: null,
      fetched_at: now,
    },
    { onConflict: "account_id" },
  );
  if (statsError) {
    log.error(
      "persist",
      `platform_stats upsert failed for ${platformId}/${target.handle}`,
      statsError,
    );
    throw new Error(statsError.message);
  }

  await writeDailySnapshot(target, profile);
  await replaceRecentSubmissions(target, profile);
  await mirrorToStudentStats(target, profile);
  await mirrorIngestionStamp(target);

  const { error: acctError } = await supabaseAdmin
    .from("student_platform_accounts")
    .update({
      status: "active",
      verified_at: now,
      last_fetched_at: now,
      fetch_error: null,
      consecutive_failures: 0,
      ...(profile.syncCursor ? { sync_cursor: profile.syncCursor as Json } : {}),
    })
    .eq("id", accountId);
  if (acctError) throw new Error(acctError.message);

  return { ok: true, status, totalSolved: profile.totalSolved ?? null };
}

/**
 * Stamp `students.last_scraped_at` when ANY platform fetch succeeds.
 *
 * ── The bug this fixes ─────────────────────────────────────────────────────
 * `students.last_scraped_at` and `students.scrape_error` were written by
 * scrape.server.ts alone — the LEGACY, LeetCode-only worker. Once refreshes
 * moved to per-platform jobs that path stopped running, so the column stayed
 * NULL no matter how many times a student was successfully fetched.
 *
 * Everything that reports ingestion health reads that column and nothing else:
 * the "N pending" badge on the classroom page counts `!last_scraped_at`, and
 * the admin scrape-runs page prints "Never". So a cohort could be fully
 * refreshed, with fresh platform_stats and fresh daily_snapshots behind it, and
 * still report every student as pending forever. The refresh was working; only
 * the column that vouches for it was frozen.
 *
 * ── Why any platform, not just LeetCode ────────────────────────────────────
 * Unlike the student_stats mirror below, this carries no per-platform numbers —
 * it answers "has this student ever been ingested at all", and a successful
 * CodeChef fetch answers that as truthfully as a LeetCode one. Keeping it
 * LeetCode-only would leave every student without a LeetCode handle pending in
 * perpetuity.
 *
 * ── Why `scrape_error` is deliberately NOT cleared here ────────────────────
 * Tempting, since the same badge counts it — but a student on five platforms
 * whose LeetCode handle is genuinely broken would have that error erased by the
 * next successful CodeChef fetch. This writes the one fact it can vouch for:
 * an ingestion happened. Per-platform failures are already tracked honestly on
 * student_platform_accounts.fetch_error, which is what the platform health page
 * reads.
 *
 * Best-effort: a failure here must not fail a refresh that already committed
 * its real data. A stale badge is a smaller problem than a chunk that reports
 * failure and gets retried.
 */
async function mirrorIngestionStamp(target: PersistTarget): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { log } = await import("./log.server");
  try {
    await supabaseAdmin
      .from("students")
      .update({ last_scraped_at: new Date().toISOString() })
      .eq("id", target.studentId);
  } catch (e) {
    log.error("persist", `ingestion stamp failed for student ${target.studentId}`, e);
  }
}

/**
 * Keep the legacy `student_stats` row in step with a LeetCode fetch.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * student_stats is written by exactly one function — scrapeStudentById in
 * scrape.server.ts — which is only reachable through the LEGACY worker. Once
 * every refresh is enqueued per-platform, every job carries a platform_id, so
 * the pump always routes to runPlatformChunk and the legacy worker is never
 * invoked again. Nothing would write student_stats.
 *
 * That table is not dead weight: it is still the source for the classroom
 * roster, the whole Overview page, student search and the profile page — and
 * for all nine behavioural buckets, which read submission_calendar. Without
 * this mirror those numbers silently freeze at the last legacy run, which looks
 * exactly like "the cohort stopped working" rather than "ingestion moved".
 *
 * ── Why a mirror rather than the VIEW ──────────────────────────────────────
 * 20260808000003 plans for student_stats to BECOME a view over platform_stats.
 * That is the right end state and it deletes this function. It is also a
 * non-additive schema change that cannot be rolled back with `git revert`, so
 * it wants its own deploy against a database you can watch. This keeps the
 * readers correct in the meantime, and is deliberately one-way: platform_stats
 * is the source, student_stats is a derived copy, so there is still only one
 * writer of the truth.
 *
 * LeetCode only — the columns are LeetCode's shape and no other adapter has
 * anywhere to put its numbers here.
 */
async function mirrorToStudentStats(target: PersistTarget, p: NormalizedProfile): Promise<void> {
  if (target.platformId !== "leetcode") return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { log } = await import("./log.server");

  // Extras live in the adapter's `data` blob rather than as typed columns.
  const d = (p.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  /*
    Only columns this fetch actually produced. A `partial` run drops the
    calendar and recent-submission calls, and writing undefined through as null
    would erase a year of heatmap data to save two seconds — the same reason the
    `data` blob above is merged instead of replaced.
  */
  const row: Record<string, unknown> = {
    student_id: target.studentId,
    updated_at: new Date().toISOString(),
  };
  const put = (col: string, v: unknown) => {
    if (v !== undefined && v !== null) row[col] = v;
  };

  put("real_name", p.displayName);
  put("avatar", p.avatar);
  put("country", p.country);
  put("total_solved", p.totalSolved);
  put("easy_solved", p.easySolved);
  put("medium_solved", p.mediumSolved);
  put("hard_solved", p.hardSolved);
  put("streak", p.streak);
  put("contest_rating", p.rating);
  put("contests_attended", p.contestsAttended);
  put("ranking", p.globalRank);
  put("reputation", num(d.reputation));
  put("total_questions", num(d.total_questions));
  put("easy_total", num(d.easy_total));
  put("medium_total", num(d.medium_total));
  put("hard_total", num(d.hard_total));
  put("acceptance_rate", num(d.acceptance_rate));
  put("total_active_days", num(d.total_active_days));
  put("contest_global_ranking", num(d.contest_global_ranking));
  put("contest_top_percentage", num(d.contest_top_percentage));
  // Empty objects mean "not fetched this run", not "no activity".
  if (d.submission_calendar && Object.keys(d.submission_calendar).length > 0) {
    row.submission_calendar = d.submission_calendar;
  }
  if (d.language_stats) row.language_stats = d.language_stats;
  if (d.tag_stats) row.tag_stats = d.tag_stats;
  if (d.badges) row.badges = d.badges;

  const { error } = await supabaseAdmin
    .from("student_stats")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(row as any, { onConflict: "student_id" });

  if (error) {
    // Non-fatal on purpose: platform_stats already holds the authoritative row,
    // so a failure here costs freshness on the legacy readers, not the fetch.
    log.error("persist", `student_stats mirror failed for ${target.handle}`, error);
  }
}

/**
 * One row per (student, platform, day). solved_that_day is differenced against
 * the most recent EARLIER snapshot, not the previous row of this run, so
 * refreshing twice in a day cannot double-count.
 */
async function writeDailySnapshot(target: PersistTarget, p: NormalizedProfile): Promise<void> {
  if (p.totalSolved === undefined || p.totalSolved === null) return; // nothing to snapshot

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);

  let prevTotal: number | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("daily_snapshots")
      .select("total_solved")
      .eq("student_id", target.studentId)
      .eq("platform_id", target.platformId)
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    prevTotal = data?.total_solved ?? null;
  } catch {
    /* first ever snapshot — a null baseline yields a 0 delta, which is correct */
  }

  try {
    await supabaseAdmin.from("daily_snapshots").upsert({
      student_id: target.studentId,
      platform_id: target.platformId,
      snapshot_date: today,
      total_solved: p.totalSolved,
      easy_solved: p.easySolved ?? 0,
      medium_solved: p.mediumSolved ?? 0,
      hard_solved: p.hardSolved ?? 0,
      unrated_solved: p.unratedSolved ?? null,
      rating: p.rating ?? null,
      platform_score: p.platformScore ?? null,
      solved_that_day: Math.max(0, p.totalSolved - (prevTotal ?? p.totalSolved)),
    });
  } catch {
    /* history is decoration on top of the real numbers — never fail a run for it */
  }
}

type RecentItem = { title?: string; titleSlug?: string; lang?: string; submittedAt?: string };

/** Rolling window, scoped to this platform so one adapter cannot clear another's. */
async function replaceRecentSubmissions(
  target: PersistTarget,
  p: NormalizedProfile,
): Promise<void> {
  const recent = p.data?.recent;
  if (!Array.isArray(recent)) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    await supabaseAdmin
      .from("recent_submissions")
      .delete()
      .eq("student_id", target.studentId)
      .eq("platform_id", target.platformId);

    // title, title_slug and submitted_at are NOT NULL in the table, so an
    // incomplete item is dropped rather than coerced into an empty string that
    // would render as a blank row in the UI.
    const rows = (recent as RecentItem[])
      .filter(
        (r): r is Required<Pick<RecentItem, "title" | "titleSlug" | "submittedAt">> & RecentItem =>
          Boolean(r.title && r.titleSlug && r.submittedAt),
      )
      .map((r) => ({
        student_id: target.studentId,
        platform_id: target.platformId,
        title: r.title,
        title_slug: r.titleSlug,
        lang: r.lang ?? null,
        submitted_at: r.submittedAt,
      }));
    if (rows.length) await supabaseAdmin.from("recent_submissions").insert(rows);
  } catch {
    /* non-critical */
  }
}

/**
 * Record a failed fetch against the account.
 *
 * The classification here is the entire point of the error taxonomy:
 *   budget      — our deadline, not their problem. Touch NOTHING, so the account
 *                 is picked up unchanged next run.
 *   not_found   — the handle is wrong. Park it immediately; five more identical
 *                 404s teach us nothing and cost five requests.
 *   throttle    — they blocked us. Record it, but do NOT count it against the
 *                 handle, or a bad afternoon retires every valid account.
 *   parse_error — our adapter broke. Same reasoning: not the handle's fault.
 */
export async function recordFetchFailure(
  target: PersistTarget,
  error: unknown,
): Promise<{ counted: boolean; parked: boolean }> {
  const kind = error instanceof PlatformError ? error.kind : "fail";
  if (kind === "budget") return { counted: false, parked: false };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const msg = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();

  if (kind === "not_found") {
    await supabaseAdmin
      .from("student_platform_accounts")
      .update({
        status: "invalid_handle",
        last_fetched_at: now,
        fetch_error: msg.slice(0, 300),
      })
      .eq("id", accountIdOf(target));
    return { counted: true, parked: true };
  }

  const blameless = kind === "throttle" || kind === "parse_error";

  const { data: current } = await supabaseAdmin
    .from("student_platform_accounts")
    .select("consecutive_failures")
    .eq("id", accountIdOf(target))
    .maybeSingle();

  const next = blameless
    ? (current?.consecutive_failures ?? 0)
    : (current?.consecutive_failures ?? 0) + 1;
  const parked = next >= ACCOUNT_FAILURE_CUTOFF;

  await supabaseAdmin
    .from("student_platform_accounts")
    .update({
      last_fetched_at: now,
      fetch_error: msg.slice(0, 300),
      consecutive_failures: next,
      ...(kind === "throttle" ? { status: "blocked" as const } : {}),
      ...(parked ? { status: "invalid_handle" as const } : {}),
    })
    .eq("id", accountIdOf(target));

  return { counted: !blameless, parked };
}

function accountIdOf(t: PersistTarget): string {
  return t.accountId;
}
