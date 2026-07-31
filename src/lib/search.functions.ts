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
  .validator((d: unknown) => z.object({
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
      .select("id, name, roll, leetcode_id");

    // Scoping goes through memberships. Resolved to a student-id list first rather
    // than an embed filter, so a student in two of the caller's cohorts still comes
    // back as ONE search result.
    let allowedClassrooms: string[] | null = null;
    if (isStaff) {
      allowedClassrooms = await accessibleClassroomIds(viewer!.userId, viewer!.role);
      if (allowedClassrooms !== null) {
        if (allowedClassrooms.length === 0) return [];
        const { data: mem } = await supabaseAdmin
          .from("classroom_students")
          .select("student_id")
          .in("classroom_id", allowedClassrooms);
        const ids = [...new Set((mem ?? []).map((m) => m.student_id))];
        if (ids.length === 0) return [];
        studentQuery = studentQuery.in("id", ids);
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

    // Cohort names per student, scoped to what this viewer may see.
    let memQuery = supabaseAdmin
      .from("classroom_students")
      .select("student_id, classrooms(name)")
      .in("student_id", students.map((s) => s.id));
    if (allowedClassrooms !== null) memQuery = memQuery.in("classroom_id", allowedClassrooms);
    const { data: memberships } = await memQuery;

    const classroomsByStudent = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const name = (m.classrooms as { name: string } | null)?.name;
      if (!name) continue;
      const list = classroomsByStudent.get(m.student_id);
      if (list) list.push(name);
      else classroomsByStudent.set(m.student_id, [name]);
    }

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
      classroom_names: (classroomsByStudent.get(s.id) ?? []).sort(),
      avatar: statsMap.get(s.id)?.avatar ?? null,
      total_solved: statsMap.get(s.id)?.total_solved ?? 0,
      masked,
    }));
  });
