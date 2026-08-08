import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";

/**
 * Week / month performance per platform, for the CEO and placement overview.
 *
 * In its own file rather than bolted onto overview.functions.ts: that handler is
 * already long and drives the existing dashboard, and a regression there would
 * break a page people use daily for a panel that is still finding its shape.
 *
 * ── The honesty requirement ────────────────────────────────────────────────
 * `first_snapshot_date` is returned per platform and is not decoration. Daily
 * history only starts when a platform's first refresh lands, and
 * `solved_that_day` on that first snapshot is 0 because there is nothing earlier
 * to difference against. At the time of writing, four of five platforms had
 * exactly one day of history.
 *
 * So a panel that simply rendered `0 solved this week` would be reporting "no
 * activity" when the truth is "no history yet" — opposite conclusions, identical
 * pixels. The UI uses this date to say "collecting since 1 Aug" instead. Same
 * rule the adapters follow when they return undefined rather than 0.
 *
 * ── A second caveat ───────────────────────────────────────────────────────
 * `solved_that_day` differences against the most recent EARLIER snapshot, not
 * against yesterday. A platform refreshed weekly therefore lands seven days of
 * gain on one date. Window TOTALS are correct; the daily distribution is lumpy
 * until every platform runs daily. Charts must be labelled as totals over the
 * window, never as "per day".
 */

/**
 * PostgREST's default db-max-rows silently truncates; ask for more explicitly.
 * Same constant and same reason as overview.functions.ts and landing.functions.ts.
 *
 * This is the bug that made the trend chart draw five days under a "last 30
 * days" caption. daily_snapshots holds one row per (student, platform, date), so
 * a cohort of 30 students across 6 platforms writes ~180 rows a DAY — the
 * default 1000-row ceiling is reached in under six days. The query orders by
 * snapshot_date ascending, so the rows that survived were the OLDEST ones, and
 * the chart confidently plotted the beginning of the window as though it were
 * the whole of it. No error, no empty state: just a short line.
 */
const MAX_ROWS = 50_000;

const Input = z.object({
  windows: z.array(z.number().int().min(1).max(365)).min(1).max(4).default([7, 30]),
  /**
   * Scope to a single cohort. Omit for "everything the caller can see", which is
   * what the institution-level overview wants. The classroom page passes an id
   * so its trend chart describes that cohort rather than the whole college.
   */
  classroomId: z.string().uuid().optional(),
});

export type PlatformWindow = {
  platform_id: string;
  platform_name: string;
  rank_metric: string;
  /** Problems solved across the window. Null when there is no history to sum. */
  solved: number | null;
  /** Students with at least one solve in the window. */
  active_students: number;
  /** Students holding a handle on this platform, the participation denominator. */
  tracked_students: number;
  /** Days of history actually available inside the window. */
  days_covered: number;
  /** ISO date of this platform's earliest snapshot, or null if it has none. */
  first_snapshot_date: string | null;
  /** Per-date totals for the trend line. */
  series: { date: string; solved: number }[];
  /**
   * Difficulty split across the window's latest snapshot per student.
   *
   * Null means the platform publishes no split — HackerRank and CodeChef put
   * their whole count in `unrated`. The UI reads these rather than a hardcoded
   * platform list to decide between a donut and a band histogram, so a platform
   * that starts reporting difficulty later needs no code change.
   */
  easy: number | null;
  medium: number | null;
  hard: number | null;
  unrated: number | null;
};

export const getPerformanceWindows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    const allowed = await accessibleClassroomIds(userId, role);
    if (allowed !== null && allowed.length === 0) return { windows: [] as WindowResult[] };

    // Narrowing to one cohort still goes through the access check rather than
    // replacing it — a caller naming a classroom must be allowed to see it.
    if (data.classroomId) {
      const { assertClassroomAccess } = await import("@/lib/authz");
      await assertClassroomAccess(userId, role, data.classroomId);
    }

    // Ranged like the rest: this is the SCOPING query, so truncating it drops
    // students from every number below at once — and the institution-wide call
    // (no classroomId) is exactly the one that selects the most memberships.
    let roomQuery = supabaseAdmin
      .from("classroom_students")
      .select("student_id")
      .range(0, MAX_ROWS - 1);
    if (data.classroomId) roomQuery = roomQuery.eq("classroom_id", data.classroomId);
    else if (allowed !== null) roomQuery = roomQuery.in("classroom_id", allowed);
    const { data: memberships } = await roomQuery;

    const studentIds = [...new Set((memberships ?? []).map((m) => m.student_id))];
    if (studentIds.length === 0) return { windows: [] as WindowResult[] };

    const maxDays = Math.max(...data.windows);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - maxDays);

    const [{ data: snaps }, { data: accounts }, { data: platformRows }, { data: firstDates }] =
      await Promise.all([
        supabaseAdmin
          .from("daily_snapshots")
          // One string literal, not a concatenation: supabase-js infers the row
          // type from the literal, and `a + b` collapses it to `string`, which
          // degrades every field to GenericStringError.
          .select(
            "student_id, platform_id, snapshot_date, solved_that_day, easy_solved, medium_solved, hard_solved, unrated_solved",
          )
          .in("student_id", studentIds)
          .gte("snapshot_date", since.toISOString().slice(0, 10))
          .order("snapshot_date", { ascending: true })
          .range(0, MAX_ROWS - 1),
        // Drives trackedByPlatform, which decides WHICH PLATFORMS the panel
        // renders at all — a truncation here does not shrink a number, it makes
        // a whole platform disappear from the report.
        supabaseAdmin
          .from("student_platform_accounts")
          .select("student_id, platform_id")
          .in("student_id", studentIds)
          .range(0, MAX_ROWS - 1),
        supabaseAdmin
          .from("platforms")
          .select("id, name, rank_metric, sort_order")
          .order("sort_order"),
        /*
          Earliest snapshot per platform, across all history rather than the
          window — that is what tells us whether a zero means "no history".

          An AGGREGATE, not a scan. This used to select every snapshot row ever
          recorded for these students and keep the first date per platform while
          walking them in JS: O(all history) to produce one row per platform,
          and truncated by the row ceiling exactly like the query above. When it
          truncated, a later-onboarded platform lost its rows off the end,
          returned null here, and the overview reported "no history yet" for a
          platform that had weeks of data. Raising the cap only delays that;
          grouping in Postgres removes it.
        */
        supabaseAdmin.rpc("first_snapshot_per_platform", { p_student_ids: studentIds }),
      ]);

    // One row per platform now, already minimised — no first-wins scan needed.
    const firstByPlatform = new Map<string, string>(
      (firstDates ?? []).map((r) => [r.platform_id, r.first_date]),
    );

    const trackedByPlatform = new Map<string, Set<string>>();
    for (const a of accounts ?? []) {
      const set = trackedByPlatform.get(a.platform_id) ?? new Set<string>();
      set.add(a.student_id);
      trackedByPlatform.set(a.platform_id, set);
    }

    const platformIds = [...trackedByPlatform.keys()];
    const meta = new Map(
      (platformRows ?? [])
        .filter((p) => platformIds.includes(p.id))
        .map((p) => [p.id, { name: p.name, rank_metric: p.rank_metric ?? "solved" }]),
    );

    const windows: WindowResult[] = data.windows.map((days) => {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - days);
      const from = cutoff.toISOString().slice(0, 10);
      const inWindow = (snaps ?? []).filter((s) => s.snapshot_date >= from);

      const platforms: PlatformWindow[] = [...meta.entries()].map(([pid, m]) => {
        const rows = inWindow.filter((s) => s.platform_id === pid);
        const dates = new Set(rows.map((s) => s.snapshot_date));
        const active = new Set(
          rows.filter((s) => (s.solved_that_day ?? 0) > 0).map((s) => s.student_id),
        );

        const byDate = new Map<string, number>();
        for (const s of rows) {
          byDate.set(
            s.snapshot_date,
            (byDate.get(s.snapshot_date) ?? 0) + (s.solved_that_day ?? 0),
          );
        }

        /*
          Difficulty is CUMULATIVE on every snapshot, unlike solved_that_day
          which is already a delta. Summing every row in the window would count
          each student once per snapshot date — a cohort with 30 days of history
          would report thirty times its real Easy count.

          So take each student's LATEST snapshot in the window and sum across
          students. `rows` is ordered by snapshot_date ascending, so the last
          write per student wins.
        */
        const latestPerStudent = new Map<string, (typeof rows)[number]>();
        for (const s of rows) latestPerStudent.set(s.student_id, s);

        let easy = 0;
        let medium = 0;
        let hard = 0;
        let unrated = 0;
        let sawSplit = false;
        let sawUnrated = false;
        for (const s of latestPerStudent.values()) {
          if (s.easy_solved != null || s.medium_solved != null || s.hard_solved != null) {
            sawSplit = true;
          }
          if (s.unrated_solved != null) sawUnrated = true;
          easy += s.easy_solved ?? 0;
          medium += s.medium_solved ?? 0;
          hard += s.hard_solved ?? 0;
          unrated += s.unrated_solved ?? 0;
        }

        // null, never 0, when the platform reports no split — the caller uses
        // this to pick a histogram over a donut, and a zeroed donut would claim
        // "nobody has solved an easy problem" rather than "not reported".
        const hasSplit = sawSplit && easy + medium + hard > 0;

        return {
          platform_id: pid,
          platform_name: m.name,
          rank_metric: m.rank_metric,
          // null, not 0, when there is nothing to sum — the caller renders
          // "collecting since" rather than implying inactivity.
          solved: rows.length ? rows.reduce((a, s) => a + (s.solved_that_day ?? 0), 0) : null,
          active_students: active.size,
          tracked_students: trackedByPlatform.get(pid)?.size ?? 0,
          days_covered: dates.size,
          first_snapshot_date: firstByPlatform.get(pid) ?? null,
          series: [...byDate.entries()]
            .map(([date, solved]) => ({ date, solved }))
            .sort((a, b) => a.date.localeCompare(b.date)),
          easy: hasSplit ? easy : null,
          medium: hasSplit ? medium : null,
          hard: hasSplit ? hard : null,
          unrated: sawUnrated ? unrated : null,
        };
      });

      return {
        days,
        platforms: platforms.sort((a, b) => a.platform_name.localeCompare(b.platform_name)),
      };
    });

    return { windows };
  });

export type WindowResult = { days: number; platforms: PlatformWindow[] };
