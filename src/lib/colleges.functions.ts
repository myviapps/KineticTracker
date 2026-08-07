import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, canViewAllClassrooms } from "@/lib/authz";

export type CollegeRollup = {
  college_id: string;
  college_name: string;
  college_slug: string;
  student_count: number;
  classroom_count: number;
  avg_score: number;
  total_score: number;
  total_solved: number;
  platforms_in_use: number;
};

/**
 * Colleges the caller may see, plus a combined total across exactly those.
 *
 * The combined figures are computed from the SAME rows that are returned, never
 * from a second unscoped query. A CEO's "all colleges" view must mean "all the
 * colleges I am assigned to" — deriving it separately is how a total ends up
 * including institutions the viewer cannot open.
 *
 * avg_score is re-derived as a student-weighted mean rather than averaging the
 * per-college averages: a 500-student campus and a 12-student one do not
 * contribute equally, and a plain mean of means would say they do.
 */
export const listColleges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    let query = supabaseAdmin.from("college_overview").select("*");

    // admin / placement_officer see every college; a CEO sees their assignments.
    const unrestricted = canViewAllClassrooms(role);
    if (!unrestricted) {
      const { data: assigned } = await supabaseAdmin
        .from("college_assignments")
        .select("college_id")
        .eq("user_id", userId);
      const ids = (assigned ?? []).map((a) => a.college_id);
      // No assignment means no colleges — not all of them.
      if (ids.length === 0) {
        return {
          colleges: [] as CollegeRollup[],
          combined: emptyCombined(),
          scope: "assigned" as const,
        };
      }
      query = query.in("college_id", ids);
    }

    const { data, error } = await query.order("college_name");
    if (error) throw new Error(error.message);

    const colleges = (data ?? []).map((c) => ({
      college_id: c.college_id!,
      college_name: c.college_name!,
      college_slug: c.college_slug!,
      student_count: Number(c.student_count ?? 0),
      classroom_count: Number(c.classroom_count ?? 0),
      avg_score: Number(c.avg_score ?? 0),
      total_score: Number(c.total_score ?? 0),
      total_solved: Number(c.total_solved ?? 0),
      platforms_in_use: Number(c.platforms_in_use ?? 0),
    })) satisfies CollegeRollup[];

    const students = colleges.reduce((a, c) => a + c.student_count, 0);
    const combined = {
      colleges: colleges.length,
      student_count: students,
      classroom_count: colleges.reduce((a, c) => a + c.classroom_count, 0),
      total_solved: colleges.reduce((a, c) => a + c.total_solved, 0),
      total_score: colleges.reduce((a, c) => a + c.total_score, 0),
      avg_score:
        students > 0
          ? Math.round((colleges.reduce((a, c) => a + c.total_score, 0) / students) * 100) / 100
          : 0,
    };

    return { colleges, combined, scope: unrestricted ? ("all" as const) : ("assigned" as const) };
  });

function emptyCombined() {
  return {
    colleges: 0,
    student_count: 0,
    classroom_count: 0,
    total_solved: 0,
    total_score: 0,
    avg_score: 0,
  };
}

/**
 * The leaderboard for one college: its top students by Almanac Score.
 *
 * Access is checked with has_college_access rather than re-derived here, so this
 * cannot drift from the RLS policy that guards the same rows.
 */
export const getCollegeLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: { collegeId: string; limit?: number }) =>
    z
      .object({ collegeId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = authContext(context);

    const { data: allowed, error: accessError } = await supabaseAdmin.rpc("has_college_access", {
      _user: userId,
      _college: data.collegeId,
    });
    // Fail closed: a transport error is not permission.
    if (accessError || !allowed) throw new Error("Forbidden");

    const { data: members } = await supabaseAdmin
      .from("student_colleges")
      .select("student_id")
      .eq("college_id", data.collegeId);
    const ids = (members ?? []).map((m) => m.student_id!).filter(Boolean);
    if (ids.length === 0) return { students: [] };

    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const ranks = await fetchStudentRanks(ids);

    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id, name, roll")
      .in("id", ids);

    const rows = (students ?? [])
      .map((s) => {
        const r = ranks.get(s.id);
        return {
          id: s.id,
          name: s.name,
          roll: s.roll,
          almanac_score: r?.almanac_score ?? 0,
          college_rank: r?.college_rank ?? null,
          platforms: r?.platform_ranks.length ?? 0,
        };
      })
      .sort((a, b) => b.almanac_score - a.almanac_score)
      .slice(0, data.limit ?? 25);

    return { students: rows };
  });
