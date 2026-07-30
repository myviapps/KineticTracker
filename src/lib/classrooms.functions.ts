import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  requireRole,
  accessibleClassroomIds,
  assertClassroomAccess,
} from "@/lib/authz";

const CreateClassroomInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
});

/**
 * Classrooms the caller may see. This used to return every classroom in the
 * database to every role, so faculty and placement officers got the full cohort
 * list — names, descriptions and headcounts — in the sidebar, on /classrooms and
 * on /dashboard. `getOverview` already scoped by assignment; this now matches it.
 */
export const listClassrooms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    const allowed = await accessibleClassroomIds(userId, role);
    if (allowed !== null && allowed.length === 0) return [];

    let query = supabaseAdmin
      .from("classrooms")
      .select("id, name, description, created_at")
      .order("created_at", { ascending: false });
    if (allowed !== null) query = query.in("id", allowed);

    const { data: classrooms, error } = await query;
    if (error) throw new Error("Failed to list classrooms");

    const countMap = new Map<string, number>();
    try {
      let countQuery = supabaseAdmin.from("students").select("classroom_id");
      if (allowed !== null) countQuery = countQuery.in("classroom_id", allowed);
      const { data: counts } = await countQuery;
      for (const r of counts ?? []) {
        countMap.set(r.classroom_id, (countMap.get(r.classroom_id) ?? 0) + 1);
      }
    } catch { /* student counts are decorative — non-fatal */ }

    return (classrooms ?? []).map((c) => ({
      ...c,
      student_count: countMap.get(c.id) ?? 0,
    }));
  });

export const getClassroom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    await assertClassroomAccess(userId, role, data.id);

    const { data: classroom, error } = await supabaseAdmin
      .from("classrooms")
      .select("id, name, description, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!classroom) throw new Error("Classroom not found");

    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, email, leetcode_id, last_scraped_at, scrape_error")
      .eq("classroom_id", data.id)
      .order("roll", { ascending: true });

    const ids = (students ?? []).map((s) => s.id);
    const statsPromise = ids.length
      ? supabaseAdmin.from("student_stats").select("*").in("student_id", ids)
      : Promise.resolve({ data: [] as any[], error: null });
    const [statsRes] = await Promise.allSettled([statsPromise]);
    const stats = statsRes.status === "fulfilled" ? statsRes.value.data ?? [] : [];

    const statsById = new Map(stats.map((s: any) => [s.student_id, s]));

    /*
      Snapshot-derived progress, alongside the LeetCode submission calendar.
      These answer different questions and were being conflated:

        submission_calendar[day] = SUBMISSIONS that UTC day (retries included),
                                   frozen at whatever the last scrape saw.
        total_solved delta       = NEWLY SOLVED unique problems between two
                                   snapshots — which are not always consecutive
                                   days, because a student can be skipped by a
                                   rate limit or the 5-strike failure cutoff.

      Returning the span lets the UI say "+34 over 3 days" instead of implying
      all 34 landed today.
    */
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 14);
    const { data: snaps } = ids.length
      ? await supabaseAdmin
          .from("daily_snapshots")
          .select("student_id, snapshot_date, total_solved")
          .in("student_id", ids)
          .gte("snapshot_date", since.toISOString().slice(0, 10))
          .order("snapshot_date", { ascending: true })
      : { data: [] as { student_id: string; snapshot_date: string; total_solved: number }[] };

    const snapsByStudent = new Map<string, { date: string; total: number }[]>();
    for (const s of snaps ?? []) {
      const list = snapsByStudent.get(s.student_id) ?? [];
      list.push({ date: s.snapshot_date, total: s.total_solved });
      snapsByStudent.set(s.student_id, list);
    }

    const dayMs = 86_400_000;
    const progressById = new Map<
      string,
      { date: string; solvedSince: number | null; daysSpan: number | null }
    >();
    for (const [studentId, list] of snapsByStudent) {
      const last = list[list.length - 1];
      const prev = list.length > 1 ? list[list.length - 2] : null;
      progressById.set(studentId, {
        date: last.date,
        solvedSince: prev ? Math.max(0, last.total - prev.total) : null,
        daysSpan: prev
          ? Math.round(
              (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / dayMs,
            )
          : null,
      });
    }

    return {
      classroom,
      students: (students ?? []).map((s) => ({
        ...s,
        stats: statsById.get(s.id) ?? null,
        progress: progressById.get(s.id) ?? null,
      })),
    };
  });

export const createClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => CreateClassroomInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("classrooms")
      .insert({ name: data.name, description: data.description ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("classrooms").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMatrixBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: { classroomId: string; startDate: string; endDate: string }) =>
    z.object({
      classroomId: z.string().uuid(),
      startDate: z.string(),
      endDate: z.string()
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    await assertClassroomAccess(userId, role, data.classroomId);

    const { data: students } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("classroom_id", data.classroomId);
      
    const studentIds = (students || []).map(s => s.id);
    if (studentIds.length === 0) return {};
    
    const { data: snapshots } = await supabaseAdmin
      .from("daily_snapshots")
      .select("student_id, snapshot_date, total_solved, easy_solved, medium_solved, hard_solved")
      .in("student_id", studentIds)
      .gte("snapshot_date", data.startDate)
      .lte("snapshot_date", data.endDate)
      .order("snapshot_date", { ascending: true });
      
    const result: Record<string, {
      latest: { total: number; easy: number; medium: number; hard: number };
      snapshots: { date: string; total: number; easy: number; medium: number; hard: number }[];
    }> = {};
    
    if (snapshots && snapshots.length > 0) {
      const byStudent = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        if (!byStudent.has(s.student_id)) byStudent.set(s.student_id, []);
        byStudent.get(s.student_id)!.push(s);
      }
      
      for (const [studentId, snaps] of byStudent.entries()) {
        if (snaps.length > 0) {
          const last = snaps[snaps.length - 1];
          result[studentId] = {
            latest: {
              total: last.total_solved,
              easy: last.easy_solved,
              medium: last.medium_solved,
              hard: last.hard_solved,
            },
            snapshots: snaps.map(s => ({
              date: s.snapshot_date,
              total: s.total_solved,
              easy: s.easy_solved,
              medium: s.medium_solved,
              hard: s.hard_solved,
            })),
          };
        }
      }
    }
    
    return result;
  });
