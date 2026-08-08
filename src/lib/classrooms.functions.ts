import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  requireRole,
  accessibleClassroomIds,
  assertClassroomAccess,
} from "@/lib/authz";
import type { Database } from "@/integrations/supabase/types";

/** Full `student_stats` row — this path `select("*")`. */
type StudentStatsRow = Database["public"]["Tables"]["student_stats"]["Row"];

/** PostgREST's default db-max-rows silently truncates; ask for more explicitly. */
const MAX_ROWS = 50_000;

const CreateClassroomInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
});

/**
 * Classrooms the caller may see. This used to return every classroom in the
 * database to every role, so faculty and placement officers got the full cohort
 * list — names, descriptions and headcounts — in the sidebar, on /classrooms and
 * on /dashboard. `getOverview` already scoped by assignment; this now matches it.
 */
export const listClassrooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    const allowed = await accessibleClassroomIds(userId, role);
    if (allowed !== null && allowed.length === 0) {
      // Typed explicitly so this branch has the SAME shape as the success path —
      // an empty literal would widen `platforms` to never[] and make the whole
      // return type a union the caller has to narrow.
      return {
        classrooms: [] as {
          id: string;
          name: string;
          description: string | null;
          created_at: string;
          student_count: number;
          platforms: ClassroomPlatformRollup[];
        }[],
        platforms: [] as CohortPlatform[],
        totalStudents: 0,
      };
    }

    let query = supabaseAdmin
      .from("classrooms")
      .select("id, name, description, created_at")
      .order("created_at", { ascending: false });
    if (allowed !== null) query = query.in("id", allowed);

    const { data: classrooms, error } = await query;
    if (error) throw new Error("Failed to list classrooms");

    /*
      Counted in Postgres rather than by pulling every student row and tallying in
      JS — that pattern was also silently truncated at PostgREST's 1000-row
      default, so headcounts were quietly wrong on any sizeable install.

      `totalStudents` is DISTINCT and is not the sum of `student_count`: a student
      in two cohorts is counted in each cohort's own number but only once overall.
    */
    const countMap = new Map<string, number>();
    let totalStudents = 0;
    try {
      const [countsRes, distinctRes] = await Promise.all([
        // `allowed` is null when the viewer is unrestricted. Both RPCs declare
        // `p_classroom_ids uuid[] default null`, so omitting the argument is
        // exactly equivalent — the regenerated types simply stopped accepting an
        // explicit null.
        supabaseAdmin.rpc("classroom_student_counts", { p_classroom_ids: allowed ?? undefined }),
        supabaseAdmin.rpc("distinct_student_count", { p_classroom_ids: allowed ?? undefined }),
      ]);
      for (const r of countsRes.data ?? []) countMap.set(r.classroom_id, Number(r.student_count));
      totalStudents = Number(distinctRes.data ?? 0);
    } catch {
      /* headcounts are decorative — non-fatal */
    }

    /*
      Per-classroom, per-platform rollups so the card grid can carry a platform
      lens instead of showing only a headcount.

      Two flat queries joined in JS rather than a nested PostgREST select: the
      embed would be `classrooms -> classroom_students -> platform_stats`, which
      is exactly the depth at which inference collapses (see the note on
      loadCohortPlatformStats) and, more practically, PostgREST's row cap applies
      to the OUTER rows so a large install would silently truncate the middle.
    */
    const ids = (classrooms ?? []).map((c) => c.id);
    const byClassroom = new Map<string, Map<string, ClassroomPlatformRollup>>();
    let platforms: CohortPlatform[] = [];

    if (ids.length) {
      try {
        const { data: memberships } = await supabaseAdmin
          .from("classroom_students")
          .select("classroom_id, student_id")
          .in("classroom_id", ids);

        const studentIds = [...new Set((memberships ?? []).map((m) => m.student_id))];

        if (studentIds.length) {
          const { loadCohortPlatformStats } = await import("./cohort-platforms.server");
          const { cohortPlatforms, platformStatsById } = await loadCohortPlatformStats(studentIds);
          platforms = cohortPlatforms;

          for (const m of memberships ?? []) {
            const perPlatform = platformStatsById.get(m.student_id);
            if (!perPlatform) continue;
            const room = byClassroom.get(m.classroom_id) ?? new Map();
            byClassroom.set(m.classroom_id, room);

            for (const [platformId, stat] of Object.entries(perPlatform)) {
              const agg = room.get(platformId) ?? {
                platform_id: platformId,
                tracked: 0,
                solved: 0,
                metric_sum: 0,
                metric_count: 0,
              };
              agg.tracked += 1;
              agg.solved += stat.total_solved ?? 0;
              // The value this platform RANKS on, so the card's headline is
              // rating for Codeforces and solved for LeetCode rather than one
              // number pretending to mean the same thing everywhere.
              const meta = cohortPlatforms.find((p) => p.id === platformId);
              const v =
                meta?.rank_metric === "rating"
                  ? stat.rating
                  : meta?.rank_metric === "score"
                    ? (stat.platform_score ?? stat.total_solved)
                    : stat.total_solved;
              if (v !== null && v !== undefined) {
                agg.metric_sum += v;
                agg.metric_count += 1;
              }
              room.set(platformId, agg);
            }
          }
        }
      } catch {
        /* the grid still renders with headcounts only */
      }
    }

    return {
      classrooms: (classrooms ?? []).map((c) => ({
        ...c,
        student_count: countMap.get(c.id) ?? 0,
        platforms: [...(byClassroom.get(c.id)?.values() ?? [])],
      })),
      // Every platform in use across the visible cohorts, for the lens.
      platforms,
      totalStudents,
    };
  });

/** One classroom's rollup for one platform, for the classrooms grid. */
export type ClassroomPlatformRollup = {
  platform_id: string;
  /** Students in this cohort holding a handle on this platform. */
  tracked: number;
  solved: number;
  metric_sum: number;
  metric_count: number;
};

export type CohortPlatform = { id: string; name: string; rank_metric: string; sort_order: number };
export type CohortPlatformStat = {
  total_solved: number | null;
  rating: number | null;
  max_rating: number | null;
  platform_score: number | null;
  global_rank: number | null;
  handle: string;
  fetch_status: string | null;
};

export const getClassroom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    await assertClassroomAccess(userId, role, data.id);

    const { data: classroom, error } = await supabaseAdmin
      .from("classrooms")
      .select("id, name, description, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!classroom) throw new Error("Classroom not found");

    // Roster comes through the membership table now. Two steps rather than an
    // embed: PostgREST cannot order the outer rows by a column on the embedded
    // resource, and this list is sorted by roll.
    const { data: memberships } = await supabaseAdmin
      .from("classroom_students")
      .select("student_id")
      .eq("classroom_id", data.id);
    const memberIds = (memberships ?? []).map((m) => m.student_id);

    const { data: students } = memberIds.length
      ? await supabaseAdmin
          .from("students")
          .select("id, name, roll, email, leetcode_id, last_scraped_at, scrape_error")
          .in("id", memberIds)
          .order("roll", { ascending: true })
      : {
          data: [] as {
            id: string;
            name: string;
            roll: string;
            email: string | null;
            leetcode_id: string;
            last_scraped_at: string | null;
            scrape_error: string | null;
          }[],
        };

    const ids = (students ?? []).map((s) => s.id);

    // How many of these students are in more than one cohort. Drives the "also in
    // N cohorts" note in the edit dialog and the branching remove-confirm copy.
    const sharedIds = new Set<string>();
    if (ids.length) {
      const { data: allMem } = await supabaseAdmin
        .from("classroom_students")
        .select("student_id, classroom_id")
        .in("student_id", ids);
      const counts = new Map<string, number>();
      for (const m of allMem ?? []) {
        counts.set(m.student_id, (counts.get(m.student_id) ?? 0) + 1);
      }
      for (const [sid, n] of counts) if (n > 1) sharedIds.add(sid);
    }

    // Class and college standing. Computed in Postgres because college rank spans
    // every student on the platform, not just this roster.
    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const ranksById = await fetchStudentRanks(ids);

    // What a delete would actually do, so the confirm dialog can say it rather
    // than repeating the now-false "and all its students".
    let deletePreview = { orphan_count: 0, shared_count: 0 };
    try {
      const { data: preview } = await supabaseAdmin.rpc("classroom_delete_preview", {
        p_classroom: data.id,
      });
      const row = Array.isArray(preview) ? preview[0] : preview;
      if (row) deletePreview = { orphan_count: row.orphan_count, shared_count: row.shared_count };
    } catch {
      /* the dialog falls back to generic copy */
    }
    const statsPromise = ids.length
      ? supabaseAdmin.from("student_stats").select("*").in("student_id", ids)
      : Promise.resolve({ data: [] as StudentStatsRow[], error: null });
    const [statsRes] = await Promise.allSettled([statsPromise]);
    const stats: StudentStatsRow[] =
      statsRes.status === "fulfilled" ? (statsRes.value.data ?? []) : [];

    const statsById = new Map(stats.map((s) => [s.student_id, s]));

    /*
      Snapshot-derived progress, alongside the LeetCode submission calendar.
      These answer different questions and were being conflated:

        submission_calendar[day] = SUBMISSIONS that UTC day (retries included),
                                   frozen at whatever the last scrape saw.
        total_solved delta       = NEWLY SOLVED unique problems between two
                                   snapshots — which are not always consecutive
                                   days, because a student can be skipped by a
                                   rate limit or the 5-strike failure cutoff.

      Returning the span lets the UI say "+34 over 3 days" instead of implying
      all 34 landed today.
    */
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 14);
    const { data: snaps } = ids.length
      ? await supabaseAdmin
          .from("daily_snapshots")
          .select("student_id, snapshot_date, total_solved")
          .in("student_id", ids)
          // MUST filter by platform. daily_snapshots is keyed
          // (student_id, platform_id, snapshot_date) since 20260808000003, so
          // without this a student with accounts on five platforms returns five
          // rows per date and the progress delta below silently diffs a LeetCode
          // total against a Codeforces one. Production already had 10 such
          // (student, date) collisions when this was found.
          .eq("platform_id", "leetcode")
          .gte("snapshot_date", since.toISOString().slice(0, 10))
          .order("snapshot_date", { ascending: true })
          // 14 days x one row per student per day passes the default 1000-row
          // ceiling at ~72 students, and the rows lost are the recent ones this
          // delta is measured against.
          .range(0, MAX_ROWS - 1)
      : { data: [] as { student_id: string; snapshot_date: string; total_solved: number }[] };

    const snapsByStudent = new Map<string, { date: string; total: number }[]>();
    for (const s of snaps ?? []) {
      const list = snapsByStudent.get(s.student_id) ?? [];
      list.push({ date: s.snapshot_date, total: s.total_solved });
      snapsByStudent.set(s.student_id, list);
    }

    const dayMs = 86_400_000;
    const progressById = new Map<
      string,
      { date: string; solvedSince: number | null; daysSpan: number | null }
    >();
    for (const [studentId, list] of snapsByStudent) {
      const last = list[list.length - 1];
      const prev = list.length > 1 ? list[list.length - 2] : null;
      progressById.set(studentId, {
        date: last.date,
        solvedSince: prev ? Math.max(0, last.total - prev.total) : null,
        daysSpan: prev
          ? Math.round(
              (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / dayMs,
            )
          : null,
      });
    }

    const { loadCohortPlatformStats } = await import("./cohort-platforms.server");
    const { cohortPlatforms, platformStatsById } = await loadCohortPlatformStats(ids);

    return {
      classroom,
      deletePreview,
      // Which platforms this cohort actually uses, for the selector. Derived from
      // the roster rather than listing every enabled platform: a tab for a site
      // nobody here has an account on is a dead end.
      platforms: cohortPlatforms,
      students: (students ?? []).map((s) => ({
        ...s,
        stats: statsById.get(s.id) ?? null,
        progress: progressById.get(s.id) ?? null,
        shared: sharedIds.has(s.id),
        ranks: ranksById.get(s.id) ?? null,
        // platform_id -> that platform's headline numbers, so the table can swap
        // columns without another round trip per tab.
        platformStats: platformStatsById.get(s.id) ?? {},
      })),
    };
  });

export const createClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => CreateClassroomInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { resolveCollegeId } = await import("./colleges.server");
    const collegeId = await resolveCollegeId({ userId: context.userId });

    const { data: row, error } = await supabaseAdmin
      .from("classrooms")
      .insert({ name: data.name, description: data.description ?? null, college_id: collegeId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

/**
 * Rename a classroom, or edit its description.
 *
 * Name collisions are rejected case-insensitively even though the table has no
 * unique constraint on `name`. The bulk importer resolves classrooms BY LOWERCASED
 * NAME (`bulk-import.functions.ts`), so two cohorts called "CSE-A" and "cse-a"
 * would make every future import pick one of them arbitrarily and silently enrol
 * students in the wrong cohort.
 */
export const updateClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: clash } = await supabaseAdmin
      .from("classrooms")
      .select("id, name")
      .ilike("name", data.name)
      .neq("id", data.id)
      .limit(1)
      .maybeSingle();
    if (clash) {
      throw new Error(`Another classroom is already called "${clash.name}".`);
    }

    const { error } = await supabaseAdmin
      .from("classrooms")
      .update({ name: data.name, description: data.description ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true, name: data.name };
  });

export const deleteClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /*
      Used to be a bare delete that relied on students.classroom_id's ON DELETE
      CASCADE to take the roster with it. With memberships that cascade would only
      remove the membership rows, orphaning students who were in no other cohort —
      invisible everywhere and never scraped again. The RPC drops the memberships
      and deletes ONLY the students left with nothing, in one transaction.
    */
    const { data: rows, error } = await supabaseAdmin.rpc("delete_classroom_cascade", {
      p_classroom: data.id,
    });
    if (error) throw new Error(error.message);

    const result = Array.isArray(rows) ? rows[0] : rows;
    return {
      ok: true,
      studentsDeleted: result?.students_deleted ?? 0,
      membershipsRemoved: result?.memberships_removed ?? 0,
    };
  });

export const getMatrixBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator(
    (d: { classroomId: string; startDate: string; endDate: string; platformId?: string }) =>
      z
        .object({
          classroomId: z.string().uuid(),
          startDate: z.string(),
          endDate: z.string(),
          // Defaulted rather than required so existing callers keep working; the
          // matrix can serve any platform once a caller asks for one.
          platformId: z.string().min(1).max(50).default("leetcode"),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    await assertClassroomAccess(userId, role, data.classroomId);

    const { data: students } = await supabaseAdmin
      .from("classroom_students")
      .select("student_id")
      .eq("classroom_id", data.classroomId);

    const studentIds = (students || []).map((s) => s.student_id);
    if (studentIds.length === 0) return {};

    const { data: snapshots } = await supabaseAdmin
      .from("daily_snapshots")
      .select("student_id, snapshot_date, total_solved, easy_solved, medium_solved, hard_solved")
      .in("student_id", studentIds)
      // Same reason as above: one platform per matrix, or every cell double-counts.
      .eq("platform_id", data.platformId)
      .gte("snapshot_date", data.startDate)
      .lte("snapshot_date", data.endDate)
      .order("snapshot_date", { ascending: true })
      // The matrix is students x dates, so the default 1000-row ceiling is hit
      // by any real cohort over a month and the grid loses its rightmost days.
      .range(0, MAX_ROWS - 1);

    const result: Record<
      string,
      {
        latest: { total: number; easy: number; medium: number; hard: number };
        snapshots: { date: string; total: number; easy: number; medium: number; hard: number }[];
      }
    > = {};

    if (snapshots && snapshots.length > 0) {
      const byStudent = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        if (!byStudent.has(s.student_id)) byStudent.set(s.student_id, []);
        byStudent.get(s.student_id)!.push(s);
      }

      for (const [studentId, snaps] of byStudent.entries()) {
        if (snaps.length > 0) {
          const last = snaps[snaps.length - 1];
          result[studentId] = {
            latest: {
              total: last.total_solved,
              easy: last.easy_solved,
              medium: last.medium_solved,
              hard: last.hard_solved,
            },
            snapshots: snaps.map((s) => ({
              date: s.snapshot_date,
              total: s.total_solved,
              easy: s.easy_solved,
              medium: s.medium_solved,
              hard: s.hard_solved,
            })),
          };
        }
      }
    }

    return result;
  });
