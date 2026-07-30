import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";

export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    // null = every classroom; an array = only these. Faculty get their assignments.
    const classroomIds = await accessibleClassroomIds(userId, role);

    // Build query for classrooms
    let classroomsQuery = supabaseAdmin.from("classrooms").select("id, name, created_at");
    if (classroomIds !== null) {
      classroomsQuery = classroomsQuery.in("id", classroomIds);
    }
    const { data: classrooms } = await classroomsQuery;

    // Build query for students
    let studentsQuery = supabaseAdmin
      .from("students")
      .select("id, name, roll, classroom_id, leetcode_id, last_scraped_at");
    if (classroomIds !== null) {
      studentsQuery = studentsQuery.in("classroom_id", classroomIds);
    }
    const { data: students } = await studentsQuery;

    const studentIds = (students ?? []).map((s: any) => s.id);

    let stats: any = [];
    if (studentIds.length > 0) {
      const [statsRes] = await Promise.allSettled([
        supabaseAdmin.from("student_stats").select("*").in("student_id", studentIds),
      ]);
      stats = statsRes.status === "fulfilled" ? statsRes.value.data ?? [] : [];
    }

    return {
      // Surfaced so the page can title itself honestly: faculty see this data
      // scoped to their own classrooms, not "cross-classroom" analytics.
      role: role as string,
      scoped: classroomIds !== null,
      classrooms: classrooms ?? [],
      students: students ?? [],
      stats,
    };
  });
