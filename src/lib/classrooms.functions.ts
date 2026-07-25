import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateClassroomInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
});

export const listClassrooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: classrooms, error } = await supabaseAdmin
    .from("classrooms")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error("Failed to list classrooms");

  const { data: counts } = await supabaseAdmin
    .from("students")
    .select("classroom_id");
  const countMap = new Map<string, number>();
  for (const r of counts ?? []) {
    countMap.set(r.classroom_id, (countMap.get(r.classroom_id) ?? 0) + 1);
  }

  return (classrooms ?? []).map((c) => ({
    ...c,
    student_count: countMap.get(c.id) ?? 0,
  }));
});

export const getClassroom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Faculty can only access classrooms they're assigned to
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role === "faculty") {
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", data.id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden");
    }

    const { data: classroom, error } = await supabaseAdmin
      .from("classrooms")
      .select("id, name, description, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!classroom) throw new Error("Classroom not found");

    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, leetcode_id, last_scraped_at, scrape_error")
      .eq("classroom_id", data.id)
      .order("roll", { ascending: true });

    const ids = (students ?? []).map((s) => s.id);
    const { data: stats } = ids.length
      ? await supabaseAdmin.from("student_stats").select("*").in("student_id", ids)
      : { data: [] as any[] };

    const statsById = new Map((stats ?? []).map((s: any) => [s.student_id, s]));

    return {
      classroom,
      students: (students ?? []).map((s) => ({
        ...s,
        stats: statsById.get(s.id) ?? null,
      })),
    };
  });

export const createClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateClassroomInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Check admin
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role !== "admin") throw new Error("Forbidden");

    const { data: row, error } = await supabaseAdmin
      .from("classrooms")
      .insert({ name: data.name, description: data.description ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role !== "admin") throw new Error("Forbidden");

    const { error } = await supabaseAdmin.from("classrooms").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMatrixBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { classroomId: string; startDate: string; endDate: string }) => 
    z.object({
      classroomId: z.string().uuid(),
      startDate: z.string(),
      endDate: z.string()
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role === "faculty") {
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", data.classroomId)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden");
    }
    
    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("classroom_id", data.classroomId);
      
    const studentIds = (students || []).map(s => s.id);
    if (studentIds.length === 0) return {};
    
    const { data: snapshots } = await supabaseAdmin
      .from("daily_snapshots")
      .select("student_id, snapshot_date, easy_solved, medium_solved, hard_solved")
      .in("student_id", studentIds)
      .gte("snapshot_date", data.startDate)
      .lte("snapshot_date", data.endDate)
      .order("snapshot_date", { ascending: true });
      
    const breakdown: Record<string, { easy: number; medium: number; hard: number; total: number }> = {};
    
    if (snapshots && snapshots.length > 0) {
      const byStudent = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        if (!byStudent.has(s.student_id)) byStudent.set(s.student_id, []);
        byStudent.get(s.student_id)!.push(s);
      }
      
      for (const [studentId, snaps] of byStudent.entries()) {
        if (snaps.length > 0) {
          const first = snaps[0];
          const last = snaps[snaps.length - 1];
          const easy = Math.max(0, last.easy_solved - first.easy_solved);
          const medium = Math.max(0, last.medium_solved - first.medium_solved);
          const hard = Math.max(0, last.hard_solved - first.hard_solved);
          breakdown[studentId] = {
            easy,
            medium,
            hard,
            total: easy + medium + hard
          };
        }
      }
    }
    
    return breakdown;
  });
