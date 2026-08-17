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
 * ── On row limits ──────────────────────────────────────────────────────────
 * daily_snapshots holds one row per (student, platform, date), so a few hundred
 * students across several platforms writes thousands of rows a week. This file
 * used to ask for them with a single `.range(0, 49_999)` and a comment claiming
 * that defeated truncation. It does not: PostgREST caps every response at
 * `db-max-rows` — 1000 on this project — whatever Range asks for. The query
 * orders by snapshot_date ascending, so the rows that survived were the OLDEST,
 * and the chart plotted the start of the window as though it were all of it.
 *
 * Reads now go through fetchAllIn / fetchAllPaged, which page until a short
 * page proves exhaustion and throw on error rather than returning a short list.
 */

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

    /*
      Paged, not `.range(0, MAX_ROWS)`. This is the SCOPING query, so losing
      rows drops students from every number below at once — and PostgREST caps
      each response at db-max-rows (1000 here) whatever Range asks for, so the
      old single-shot range silently kept only the first 1000 memberships.
    */
    const { fetchAllPaged } = await import("./supabase-batch.server");
    const memberships = await fetchAllPaged((from, to) => {
      let q = supabaseAdmin.from("classroom_students").select("student_id").range(from, to);
      if (data.classroomId) q = q.eq("classroom_id", data.classroomId);
      else if (allowed !== null) q = q.in("classroom_id", allowed);
      return q;
    }, "performance: memberships");

    const studentIds = [...new Set(memberships.map((m) => m.student_id))];
    if (studentIds.length === 0) return { windows: [] as WindowResult[] };

    const maxDays = Math.max(...data.windows);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - maxDays);

    /*
      Chunked AND paged, and every error is thrown.

      Both reads below filter by `.in("student_id", …)`. At institution scope
      that is ~489 uuids, an ~18KB query string, and the request does not
      truncate — it fails with an opaque `TypeError: fetch failed`. The previous
      code destructured `{ data }` and dropped `error` on the floor, so the
      failure became an empty array: no snapshots, no accounts, no platforms in
      `meta`, and the panel rendered "0 solved over 7d" against a table holding
      549. Silent zeros are worse than an error page, because they look like an
      answer. See supabase-batch.server.ts.
    */
    const { fetchAllIn } = await import("./supabase-batch.server");
    const fromDate = since.toISOString().slice(0, 10);

    const [snaps, accounts, { data: platformRows, error: platErr }, firstDates] = await Promise.all(
      [
        fetchAllIn(
          studentIds,
          (batch, from, to) =>
            supabaseAdmin
              .from("daily_snapshots")
              // One string literal, not a concatenation: supabase-js infers the row
              // type from the literal, and `a + b` collapses it to `string`, which
              // degrades every field to GenericStringError.
              .select(
                "student_id, platform_id, snapshot_date, solved_that_day, easy_solved, medium_solved, hard_solved, unrated_solved",
              )
              .in("student_id", batch)
              .gte("snapshot_date", fromDate)
              .order("snapshot_date", { ascending: true })
              .range(from, to),
          "performance: snapshots",
        ),
        // Drives trackedByPlatform, which decides WHICH PLATFORMS the panel
        // renders at all — losing rows here does not shrink a number, it makes
        // a whole platform disappear from the report.
        fetchAllIn(
          studentIds,
          (batch, from, to) =>
            supabaseAdmin
              .from("student_platform_accounts")
              .select("student_id, platform_id")
              .in("student_id", batch)
              .range(from, to),
          "performance: accounts",
        ),
        supabaseAdmin
          .from("platforms")
          .select("id, name, rank_metric, sort_order")
          .order("sort_order"),
        /*
        Earliest snapshot per platform, across all history rather than the
        window — that is what tells us whether a zero means "no history".

        An AGGREGATE, not a scan, and an RPC rather than a filtered select: the
        id list goes in the POST body, so it is immune to the URL ceiling that
        breaks the two reads above.
      */
        supabaseAdmin.rpc("first_snapshot_per_platform", { p_student_ids: studentIds }),
      ],
    );
    if (platErr) throw new Error(`performance: platforms: ${platErr.message}`);

    /*
      One row per platform, already minimised — no first-wins scan needed.

      With a FALLBACK, because a missing RPC must not read as "no history".
      first_snapshot_per_platform ships in migration 20260809000004, and a
      deployment that has not applied it gets an error here rather than rows.
      Treating that as null made the panel print "no history yet · 489 tracked"
      directly beside "7,028 solved over 7d" — two statements that cannot both
      be true, and the more alarming one was the lie.

      The fallback is the earliest date we actually observed in the window. That
      is a LOWER BOUND on history, not the true start, so the caption may say
      "collecting since" a later date than reality — but it can only understate
      history, never deny it.
    */
    const firstByPlatform = new Map<string, string>();
    if (firstDates.error) {
      for (const s of snaps) {
        const seen = firstByPlatform.get(s.platform_id);
        if (!seen || s.snapshot_date < seen) firstByPlatform.set(s.platform_id, s.snapshot_date);
      }
    } else {
      for (const r of firstDates.data ?? []) firstByPlatform.set(r.platform_id, r.first_date);
    }

    const trackedByPlatform = new Map<string, Set<string>>();
    for (const a of accounts) {
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
      const inWindow = snaps.filter((s) => s.snapshot_date >= from);

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
