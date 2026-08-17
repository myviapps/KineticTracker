import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";
import type { Database } from "@/integrations/supabase/types";

/** Full `student_stats` row — these paths `select("*")`. */
type StudentStatsRow = Database["public"]["Tables"]["student_stats"]["Row"];

/**
 * Cross-cohort analytics.
 *
 * Returns ONE ROW PER STUDENT carrying `classroom_ids`, not one row per membership.
 * Almost everything the overview page computes is per student — bucket counts,
 * totals, active-in-30d, the leaderboard, the 30-day trend, the headcount — and a
 * membership-shaped payload would make every one of them double-count a shared
 * student. Exactly one thing (the per-classroom rollup) is per membership, and the
 * array serves it correctly.
 *
 * `classroom_ids` is filtered to what the caller may see, because the membership
 * query below is already scoped: a faculty member must never learn that one of
 * their students is also enrolled in a cohort they aren't assigned to.
 */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    // null = every classroom; an array = only these. Faculty get their assignments.
    const classroomIds = await accessibleClassroomIds(userId, role);

    let classroomsQuery = supabaseAdmin.from("classrooms").select("id, name, created_at");
    if (classroomIds !== null) classroomsQuery = classroomsQuery.in("id", classroomIds);
    const { data: classrooms } = await classroomsQuery;

    /*
      Memberships are the scoping query, so losing rows here drops students from
      every number on the page. Paged rather than a single `.range(0, MAX_ROWS)`,
      because PostgREST caps each response at db-max-rows (1000) regardless of
      what Range asks for — the old call was one cohort's growth away from
      silently dropping students. See supabase-batch.server.ts.
    */
    const { fetchAllPaged, fetchAllIn } = await import("./supabase-batch.server");
    const memberships = await fetchAllPaged((from, to) => {
      let q = supabaseAdmin
        .from("classroom_students")
        .select("student_id, classroom_id")
        .range(from, to);
      if (classroomIds !== null) q = q.in("classroom_id", classroomIds);
      return q;
    }, "overview: rosters");

    const classroomIdsByStudent = new Map<string, string[]>();
    for (const m of memberships) {
      const list = classroomIdsByStudent.get(m.student_id);
      if (list) list.push(m.classroom_id);
      else classroomIdsByStudent.set(m.student_id, [m.classroom_id]);
    }
    const studentIds = [...classroomIdsByStudent.keys()];

    const students = await fetchAllIn(
      studentIds,
      (batch, from, to) =>
        supabaseAdmin
          .from("students")
          .select("id, name, roll, leetcode_id, last_scraped_at")
          .in("id", batch)
          .range(from, to),
      "overview: students",
    );

    let stats: StudentStatsRow[] = [];
    try {
      stats = await fetchAllIn<StudentStatsRow>(
        studentIds,
        (batch, from, to) =>
          supabaseAdmin.from("student_stats").select("*").in("student_id", batch).range(from, to),
        "overview: stats",
      );
    } catch {
      /* an overview without stats still renders the roster */
    }

    /*
      Per-platform numbers, so this page can carry the same platform lens as the
      classroom page. Reuses the classroom loader rather than a second
      implementation — the lens helpers all read CohortPlatformStat, and two
      queries producing "nearly the same shape" is how the two views would start
      disagreeing about what a platform reports.
    */
    const { loadCohortPlatformStats } = await import("./cohort-platforms.server");
    const { cohortPlatforms, platformStatsById } = await loadCohortPlatformStats(studentIds);

    // Cross-platform standing (Almanac Score), same source the classroom page
    // already uses — without it the "all platforms" lens has no honest metric
    // to rank or sum by and falls back to LeetCode-only totals.
    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const ranksById = await fetchStudentRanks(studentIds);

    /*
      Newly solved per student over several windows, so the classroom
      leaderboard can show movement next to size.

      `solved_that_day` is already a delta against each student's previous
      snapshot, so summing it across a window is correct — unlike the cumulative
      difficulty columns, which would count a student once per snapshot date.

      All four windows come from ONE fetch and are bucketed in memory: the 30-day
      rows are a superset of the rest, and four round trips to slice the same
      data differently would be three too many.

      Dates are UTC because snapshot_date is UTC. "Today" therefore means the
      current UTC day, which is what the scraper writes against — deriving it
      from local time would make the card empty for the first 5.5 hours of an
      IST day.
    */
    const dayIso = (offset: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const todayIso = dayIso(0);
    const yesterdayIso = dayIso(1);
    const from7 = dayIso(7);
    const from30 = dayIso(30);

    type Gains = { today: number; yesterday: number; d7: number; d30: number };
    const gainsByStudent = new Map<string, Gains>();
    try {
      const snaps = await fetchAllIn(
        studentIds,
        (batch, from, to) =>
          supabaseAdmin
            .from("daily_snapshots")
            .select("student_id, snapshot_date, solved_that_day")
            .in("student_id", batch)
            .gte("snapshot_date", from30)
            .range(from, to),
        "overview: snapshots",
      );
      for (const s of snaps) {
        const g = gainsByStudent.get(s.student_id) ?? { today: 0, yesterday: 0, d7: 0, d30: 0 };
        const n = s.solved_that_day ?? 0;
        g.d30 += n;
        if (s.snapshot_date >= from7) g.d7 += n;
        if (s.snapshot_date === todayIso) g.today += n;
        if (s.snapshot_date === yesterdayIso) g.yesterday += n;
        gainsByStudent.set(s.student_id, g);
      }
    } catch {
      /* movement is additive detail; the leaderboard still ranks without it */
    }

    return {
      // Surfaced so the page can title itself honestly: faculty see this data
      // scoped to their own classrooms, not "cross-classroom" analytics.
      role: role as string,
      scoped: classroomIds !== null,
      classrooms: classrooms ?? [],
      platforms: cohortPlatforms,
      students: students.map((s) => ({
        ...s,
        classroom_ids: classroomIdsByStudent.get(s.id) ?? [],
        platformStats: platformStatsById.get(s.id) ?? {},
        ranks: ranksById.get(s.id) ?? null,
        /** Newly solved: today, yesterday, last 7 days, last 30 days (UTC). */
        gains: gainsByStudent.get(s.id) ?? { today: 0, yesterday: 0, d7: 0, d30: 0 },
      })),
      stats,
    };
  });
