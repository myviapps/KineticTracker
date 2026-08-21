// Refresh ONE student across every platform they hold an account on.
//
// The per-student Refresh button used to call `scrapeStudentById` and nothing
// else. That is the LEGACY, LeetCode-only path: it writes `student_stats`,
// `daily_snapshots` and `recent_submissions`, and never touches
// `platform_stats` or `student_platform_accounts`.
//
// Which made the one sequence that matters most fail silently. Correcting a
// handle DELETES that student's `platform_stats` row on purpose — see
// `resetPlatformBaseline`: the stored total belongs to the previous profile, and
// left in place the scraper's regression guard rejects every future fetch
// forever. But every cross-student view — the classroom roster, Overview,
// rankings, the Almanac score, the platform strip — reads `platform_stats`. So
// "fix the username, press Refresh" left the student blank everywhere except
// their own profile, and pressing Refresh again could never repair it: the
// button had no code path that writes the table it needed to write.
//
// This is the same fetch-and-persist the chunk worker performs, minus the job
// machinery, which is deliberately not reused here. `enqueue_platform_refresh_job`
// takes a per-platform single-flight lock, so refreshing one student would
// either queue behind a full platform run or, forced, cancel it — a heavy price
// for one row, and the result would not be visible by the time the button
// stopped spinning.

import { log } from "./log.server";
import { getAdapter } from "./platforms/registry";
import { PlatformError } from "./platforms/types";
import { persistPlatformProfile, recordFetchFailure } from "./platform-stats.server";

export type StudentPlatformRefresh = {
  platform_id: string;
  handle: string;
  ok: boolean;
  /** Present only when ok is false. Already trimmed for display. */
  error?: string;
};

/**
 * Budget, not a timeout.
 *
 * The whole request runs inside a 60s Vercel function that also runs the legacy
 * LeetCode scrape, so this leaves room for it rather than spending the lot.
 * A student on more platforms than fit simply has the rest picked up by the
 * next scheduled run — reported, not silently dropped.
 */
const DEFAULT_BUDGET_MS = 25_000;

export async function refreshStudentPlatforms(
  studentId: string,
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<StudentPlatformRefresh[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const deadline = Date.now() + budgetMs;

  const [{ data: accounts, error }, { data: platforms }] = await Promise.all([
    supabaseAdmin
      .from("student_platform_accounts")
      .select("id, platform_id, handle, sync_cursor")
      .eq("student_id", studentId),
    supabaseAdmin.from("platforms").select("id, enabled, base_cooldown_ms"),
  ]);
  if (error) throw new Error(error.message);

  const config = new Map((platforms ?? []).map((p) => [p.id, p]));

  // A disabled platform is not refreshed even when a handle exists for it —
  // same rule the worker follows, so the button cannot quietly re-enable a
  // platform an admin switched off.
  const targets = (accounts ?? []).filter(
    (a) => config.get(a.platform_id)?.enabled && getAdapter(a.platform_id),
  );

  const results: StudentPlatformRefresh[] = [];

  for (const account of targets) {
    const target = {
      accountId: account.id,
      studentId,
      platformId: account.platform_id,
      handle: account.handle,
    };

    if (Date.now() >= deadline) {
      // Not counted as a failure: WE ran out of time, the handle is fine. Same
      // distinction the chunk worker draws for its "budget" errors, and for the
      // same reason — counting this would park a working handle.
      results.push({
        platform_id: account.platform_id,
        handle: account.handle,
        ok: false,
        error: "Skipped — refresh budget spent; will be picked up by the next run",
      });
      continue;
    }

    try {
      const adapter = getAdapter(account.platform_id)!;
      const profile = await adapter.fetchProfile(account.handle, {
        deadline,
        callGapMs: config.get(account.platform_id)?.base_cooldown_ms ?? 0,
        syncCursor: (account.sync_cursor as Record<string, unknown> | null) ?? undefined,
      });

      const outcome = await persistPlatformProfile(target, profile);
      // A rejected write is a failure of this refresh, not a success with a
      // caveat — persistPlatformProfile refuses implausible data, and reporting
      // that as "Refreshed" is how a frozen student stays frozen unnoticed.
      if (!outcome.ok) {
        throw new PlatformError("parse_error", 200, outcome.reason, account.platform_id);
      }

      results.push({ platform_id: account.platform_id, handle: account.handle, ok: true });
    } catch (e) {
      await recordFetchFailure(target, e);
      const message = e instanceof Error ? e.message : String(e);
      log.warn(
        "refresh",
        `  ✕ ${account.platform_id}/${account.handle} for student ${studentId.slice(0, 8)}: ${message}`,
      );
      results.push({
        platform_id: account.platform_id,
        handle: account.handle,
        ok: false,
        error: message.slice(0, 200),
      });
    }
  }

  return results;
}
