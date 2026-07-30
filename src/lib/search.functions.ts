import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { accessibleClassroomIds, resolveOptionalViewer } from "@/lib/authz";
import { maskHandle, maskName } from "@/lib/mask";

/**
 * Student lookup for the landing page. Two very different contracts depending on
 * who is asking:
 *
 *   Anonymous — EXACT roll match only, max one result, identity masked. Previously
 *   this ran an unauthenticated `ilike %q%` across name, roll and handle via the
 *   service-role client, so a two-character query returned a slice of the whole
 *   directory and the entire student body could be enumerated by anyone. Requiring
 *   a complete roll number keeps the "check my own progress" flow and removes the
 *   enumeration primitive.
 *
 *   Signed-in staff — fuzzy match as before, but restricted to classrooms they can
 *   actually access, and unmasked.
 *
 * `email` is deliberately not searchable in either mode.
 */
export const searchStudents = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({
    // Kept deliberately strict: `q` is interpolated into a PostgREST `or` filter
    // below, and this character class excludes the comma, parens and percent that
    // would let a caller restructure the filter.
    q: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9\s.\-_@]+$/),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.q.trim();

    const viewer = await resolveOptionalViewer();
    const isStaff = !!viewer?.role;
    const masked = !isStaff;

    let studentQuery = supabaseAdmin
      .from("students")
      .select("id, name, roll, leetcode_id, classroom_id");

    if (isStaff) {
      const allowed = await accessibleClassroomIds(viewer!.userId, viewer!.role);
      if (allowed !== null) {
        if (allowed.length === 0) return [];
        studentQuery = studentQuery.in("classroom_id", allowed);
      }
      const like = q.toLowerCase();
      studentQuery = studentQuery
        .or(`roll.ilike.%${like}%,name.ilike.%${like}%,leetcode_id.ilike.%${like}%`)
        .limit(20);
    } else {
      // Exact, case-insensitive roll. No wildcards, so nothing to enumerate.
      studentQuery = studentQuery.ilike("roll", q).limit(1);
    }

    const { data: students, error } = await studentQuery;
    if (error) throw new Error("Search failed");
    if (!students || students.length === 0) return [];

    const classroomIds = [...new Set(students.map((s) => s.classroom_id))];
    const { data: classrooms } = await supabaseAdmin
      .from("classrooms")
      .select("id, name")
      .in("id", classroomIds);
    const classroomMap = new Map((classrooms ?? []).map((c) => [c.id, c.name]));

    const studentIds = students.map((s) => s.id);
    const { data: stats } = await supabaseAdmin
      .from("student_stats")
      .select("student_id, avatar, total_solved")
      .in("student_id", studentIds);
    const statsMap = new Map((stats ?? []).map((s: any) => [s.student_id, s]));

    return students.map((s) => ({
      id: s.id,
      roll: s.roll,
      name: masked ? maskName(s.name) : s.name,
      leetcode_id: masked ? maskHandle(s.leetcode_id) : s.leetcode_id,
      classroom_name: classroomMap.get(s.classroom_id) ?? null,
      avatar: statsMap.get(s.id)?.avatar ?? null,
      total_solved: statsMap.get(s.id)?.total_solved ?? 0,
      masked,
    }));
  });
