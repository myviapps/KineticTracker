import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Determine user's scope
    const { data: userRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();

    const isAdmin = userRole?.role === "admin";
    const isPO = userRole?.role === "placement_officer";
    const isFaculty = userRole?.role === "faculty";

    if (!isAdmin && !isPO && !isFaculty) throw new Error("Forbidden");

    let classroomIds: string[] | null = null; // null = all

    if (isFaculty) {
      // Get faculty's assigned classrooms
      const { data: assignments } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId);
      classroomIds = (assignments ?? []).map((a) => a.classroom_id);
    }

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

    // Build query for stats
    let statsQuery = supabaseAdmin.from("student_stats").select("*");
    if (studentIds.length > 0) {
      statsQuery = statsQuery.in("student_id", studentIds);
    }
    const { data: stats } = await statsQuery;

    return {
      classrooms: classrooms ?? [],
      students: students ?? [],
      stats: stats ?? [],
    };
  });
