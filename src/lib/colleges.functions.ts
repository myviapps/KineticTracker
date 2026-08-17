import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, requireRole } from "@/lib/authz";

/**
 * Does this user have any college assignment at all?
 *
 * Distinguishes "scoped to these colleges" from "never scoped", which is the
 * difference between a placement officer who opted into scoping and one who has
 * simply never been assigned.
 */
async function hasCollegeAssignment(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("college_assignments")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

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

    /*
      Admin sees every college. CEO and placement officer see the ones assigned
      to them — the officer used to be lumped in with admin via
      canViewAllClassrooms, so assigning one to a college had no effect here
      either.

      The unassigned case differs by role, matching accessibleClassroomIds: an
      unassigned CEO sees nothing (the role is meaningless without a college),
      an unassigned placement officer keeps platform-wide reach so existing
      accounts are not blanked. Assigning a college is what opts them in.
    */
    const unrestricted =
      role === "admin" || (role === "placement_officer" && !(await hasCollegeAssignment(userId)));
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

/**
 * Turn a display name into a stable URL handle.
 *
 * The slug is what imports and links key on, so it is derived once at creation
 * and never re-derived on rename — renaming "CMRTC" to "CMR Technical Campus"
 * must not break a bookmarked link or a spreadsheet column.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Create a college.
 *
 * Admin-only. Colleges were entirely read-only to the application until now —
 * there was no create, rename or delete anywhere — so the only way to add one
 * was direct SQL, and the only way to remove a mistake was the same. That is
 * also how two empty demo colleges ended up permanently stuck in the picker.
 */
export const createCollege = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        city: z.string().trim().max(120).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const base = slugify(data.name);
    if (!base) throw new Error("Name must contain at least one letter or number");

    /*
      Both name and slug are UNIQUE. A name clash is the user's to fix — they
      almost certainly mean the college that already exists — but a slug clash
      can happen between genuinely different names ("St. Mary's" / "St Marys"),
      so that one is resolved silently with a numeric suffix rather than made
      the caller's problem.
    */
    let slug = base;
    for (let n = 2; n < 50; n += 1) {
      const { data: taken } = await supabaseAdmin
        .from("colleges")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    const { data: row, error } = await supabaseAdmin
      .from("colleges")
      .insert({ name: data.name, slug, city: data.city || null })
      .select("id, name, slug")
      .single();

    if (error) {
      if (error.code === "23505") throw new Error(`A college named "${data.name}" already exists`);
      throw new Error(error.message);
    }
    return row;
  });

/** Rename a college, or set its city. The slug is deliberately left alone. */
export const updateCollege = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        city: z.string().trim().max(120).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("colleges")
      .update({ name: data.name, city: data.city || null })
      .eq("id", data.id);
    if (error) {
      if (error.code === "23505") throw new Error(`A college named "${data.name}" already exists`);
      throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Delete a college — only when nothing depends on it.
 *
 * Deliberately NOT a cascade. `classrooms.college_id` is NOT NULL and
 * `college_assignments` cascades on delete, so removing a populated college
 * would either fail at the constraint or silently strip every CEO's access.
 * Refusing with a count says what to do instead, which is what the caller needs
 * — deleting a real institution's cohorts is never the intent behind a tidy-up.
 */
export const deleteCollege = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ count: classrooms }, { count: assignments }] = await Promise.all([
      supabaseAdmin
        .from("classrooms")
        .select("*", { count: "exact", head: true })
        .eq("college_id", data.id),
      supabaseAdmin
        .from("college_assignments")
        .select("*", { count: "exact", head: true })
        .eq("college_id", data.id),
    ]);

    if ((classrooms ?? 0) > 0) {
      throw new Error(
        `This college still has ${classrooms} classroom${classrooms === 1 ? "" : "s"}. Move or delete them first.`,
      );
    }
    if ((assignments ?? 0) > 0) {
      throw new Error(
        `${assignments} staff member${assignments === 1 ? " is" : "s are"} still assigned to this college. Unassign them first.`,
      );
    }

    const { error } = await supabaseAdmin.from("colleges").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
