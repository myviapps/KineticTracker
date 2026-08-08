import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";
import type { Database } from "@/integrations/supabase/types";

/** Full `student_stats` row — these paths `select("*")`. */
type StudentStatsRow = Database["public"]["Tables"]["student_stats"]["Row"];

/** PostgREST's default db-max-rows silently truncates; ask for more explicitly. */
const MAX_ROWS = 50_000;

/** `.in()` with thousands of uuids blows the request URL length limit. */
const CHUNK = 500;

async function chunked<T>(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await run(ids.slice(i, i + CHUNK));
    if (data) out.push(...data);
  }
  return out;
}

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

    // Memberships are the scoping query now.
    let memQuery = supabaseAdmin
      .from("classroom_students")
      .select("student_id, classroom_id")
      .range(0, MAX_ROWS - 1);
    if (classroomIds !== null) memQuery = memQuery.in("classroom_id", classroomIds);
    const { data: memberships, error: memErr } = await memQuery;
    if (memErr) throw new Error("Failed to load rosters");

    const classroomIdsByStudent = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const list = classroomIdsByStudent.get(m.student_id);
      if (list) list.push(m.classroom_id);
      else classroomIdsByStudent.set(m.student_id, [m.classroom_id]);
    }
    const studentIds = [...classroomIdsByStudent.keys()];

    const students = await chunked(studentIds, (batch) =>
      supabaseAdmin
        .from("students")
        .select("id, name, roll, leetcode_id, last_scraped_at")
        .in("id", batch),
    );

    let stats: StudentStatsRow[] = [];
    try {
      stats = await chunked<StudentStatsRow>(studentIds, (batch) =>
        supabaseAdmin.from("student_stats").select("*").in("student_id", batch),
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
      })),
      stats,
    };
  });
