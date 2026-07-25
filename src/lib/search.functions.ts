import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const searchStudents = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({
    q: z.string().min(2).max(100).regex(/^[a-zA-Z0-9\s.\-_@]+$/),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.q.trim().toLowerCase();

    // Search across roll, name, leetcode_id (PII-safe: email deliberately excluded)
    const { data: students, error } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, leetcode_id, classroom_id")
      .or(`roll.ilike.%${q}%,name.ilike.%${q}%,leetcode_id.ilike.%${q}%`)
      .limit(20);

    if (error) throw new Error("Search failed");

    // Attach classroom names
    const classroomIds = [...new Set((students ?? []).map((s) => s.classroom_id))];
    const { data: classrooms } = await supabaseAdmin
      .from("classrooms")
      .select("id, name")
      .in("id", classroomIds);
    const classroomMap = new Map((classrooms ?? []).map((c) => [c.id, c.name]));

    // Attach stats for avatars/totals
    const studentIds = (students ?? []).map((s) => s.id);
    const { data: stats } = studentIds.length
      ? await supabaseAdmin.from("student_stats").select("student_id, avatar, total_solved").in("student_id", studentIds)
      : { data: [] as any[] };
    const statsMap = new Map((stats ?? []).map((s: any) => [s.student_id, s]));

    return (students ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      roll: s.roll,
      leetcode_id: s.leetcode_id,
      classroom_name: classroomMap.get(s.classroom_id) ?? null,
      avatar: statsMap.get(s.id)?.avatar ?? null,
      total_solved: statsMap.get(s.id)?.total_solved ?? 0,
    }));
  });
