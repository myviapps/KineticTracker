import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { accessibleClassroomIds, resolveOptionalViewer } from "@/lib/authz";
import { maskHandle, maskName } from "@/lib/mask";
import { requirePublicRateLimit } from "@/lib/rate-limit.server";

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
  .validator((d: unknown) =>
    z
      .object({
        // Kept deliberately strict: `q` is interpolated into a PostgREST `or` filter
        // below, and this character class excludes the comma, parens and percent that
        // would let a caller restructure the filter.
        q: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9\s.\-_@]+$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.q.trim();

    const viewer = await resolveOptionalViewer();
    const isStaff = !!viewer?.role;
    const masked = !isStaff;

    // Anonymous callers are rate limited per IP. The public contract is "look
    // yourself up by roll", which needs a handful of requests, not a directory
    // walk. Staff are exempt: they are authenticated and already scoped.
    if (!isStaff) await requirePublicRateLimit("search");

    let studentQuery = supabaseAdmin.from("students").select("id, name, roll, leetcode_id");

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
      // Exact, case-insensitive roll.
      //
      // `_` and `%` are LIKE metacharacters. The validator above permits `_`
      // because staff search legitimately matches handles containing it, but on
      // this branch a single `_` would turn "you must know the exact roll" back
      // into a character-by-character walk of the directory — `24CS0__` matches
      // rolls the caller never knew. That is precisely the enumeration primitive
      // the header comment says was removed, so reject rather than escape.
      if (/[_%]/.test(q)) return [];
      studentQuery = studentQuery.ilike("roll", q).limit(1);
    }

    let { data: students, error } = await studentQuery;
    if (error) throw new Error("Search failed");
    if (!students || students.length === 0) return [];

    // Belt and braces: whatever LIKE did above, an anonymous caller only ever
    // gets back a row whose roll is an exact case-insensitive match.
    if (!isStaff) {
      const needle = q.toLowerCase();
      students = students.filter((s) => s.roll?.toLowerCase() === needle);
      if (students.length === 0) return [];
    }

    // Cohort names per student, scoped to what this viewer may see.
    //
    // Skipped entirely for anonymous callers. `allowedClassrooms` stays null for
    // anon, which used to mean the scoping filter below never applied and every
    // cohort name came back unmasked — the opposite of the intent. Cohort
    // membership is exactly what masking withholds, and getStudentByRoll already
    // suppresses it for masked viewers (students.functions.ts). The two public
    // endpoints now agree.
    const classroomsByStudent = new Map<string, string[]>();
    if (isStaff) {
      let memQuery = supabaseAdmin
        .from("classroom_students")
        .select("student_id, classrooms(name)")
        .in(
          "student_id",
          students.map((s) => s.id),
        );
      if (allowedClassrooms !== null) memQuery = memQuery.in("classroom_id", allowedClassrooms);
      const { data: memberships } = await memQuery;

      for (const m of memberships ?? []) {
        const name = (m.classrooms as { name: string } | null)?.name;
        if (!name) continue;
        const list = classroomsByStudent.get(m.student_id);
        if (list) list.push(name);
        else classroomsByStudent.set(m.student_id, [name]);
      }
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
