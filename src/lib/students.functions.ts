import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth, requireAdmin } from "@/integrations/supabase/auth-middleware";

const StudentInput = z.object({
  classroom_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  roll: z.string().trim().min(1).max(50),
  email: z.string().trim().email().optional().or(z.literal("")).nullable().optional(),
  leetcode_id: z.string().trim().min(1).max(100),
});

const BulkInput = z.object({
  classroom_id: z.string().uuid(),
  rows: z.array(
    z.object({
      name: z.string().trim().min(1).max(100),
      roll: z.string().trim().min(1).max(50),
      email: z.string().trim().max(200).optional().nullable(),
      leetcode_id: z.string().trim().min(1).max(100),
    }),
  ).min(1).max(500),
});

export const addStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StudentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Check access
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = role?.role === "admin";
    const isFaculty = role?.role === "faculty";
    if (!isAdmin && !isFaculty) throw new Error("Forbidden");
    if (isFaculty) {
      // Check they're assigned to this classroom
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", data.classroom_id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
    }

    const email = data.email && data.email.length > 0 ? data.email : null;
    const { data: row, error } = await supabaseAdmin
      .from("students")
      .insert({
        classroom_id: data.classroom_id,
        name: data.name,
        roll: data.roll,
        email,
        leetcode_id: data.leetcode_id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    try {
      const { scrapeStudentById } = await import("./scrape.server");
      await scrapeStudentById(row.id);
    } catch (e) {
      console.error(`Scrape failed for ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { id: row.id };
  });

export const bulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BulkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = role?.role === "admin";
    const isFaculty = role?.role === "faculty";
    if (!isAdmin && !isFaculty) throw new Error("Forbidden");
    if (isFaculty) {
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", data.classroom_id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden");
    }

    const keyed = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) {
      const key = `${data.classroom_id}:${r.roll}`;
      keyed.set(key, r);
    }
    const payload = Array.from(keyed.values()).map((r) => ({
      classroom_id: data.classroom_id,
      name: r.name,
      roll: r.roll,
      email: r.email && r.email.length > 0 ? r.email : null,
      leetcode_id: r.leetcode_id,
    }));
    const { data: rows, error } = await supabaseAdmin
      .from("students")
      .upsert(payload, { onConflict: "classroom_id,roll" })
      .select("id");
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    if (ids.length > 0) {
      await supabaseAdmin.rpc("enqueue_refresh_job", {
        p_scope: "students",
        p_student_ids: ids,
        p_created_by: context.userId,
      });
    }

    return { inserted: rows?.length ?? 0 };
  });

export const deleteStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = role?.role === "admin";
    const isFaculty = role?.role === "faculty";
    if (!isAdmin && !isFaculty) throw new Error("Forbidden");

    if (isFaculty) {
      const { data: student } = await supabaseAdmin
        .from("students")
        .select("classroom_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!student) throw new Error("Student not found");
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", student.classroom_id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
    }

    const { error } = await supabaseAdmin.from("students").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
      roll: z.string().trim().min(1).max(50),
      email: z.string().trim().email().optional().or(z.literal("")).nullable().optional(),
      leetcode_id: z.string().trim().min(1).max(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isAdmin = role?.role === "admin";
    const isFaculty = role?.role === "faculty";
    if (!isAdmin && !isFaculty) throw new Error("Forbidden");

    if (isFaculty) {
      // Ensure the faculty member is assigned to this student's classroom
      const { data: student } = await supabaseAdmin
        .from("students")
        .select("classroom_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!student) throw new Error("Student not found");
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", student.classroom_id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
    }

    const email = data.email && data.email.length > 0 ? data.email : null;
    const { error } = await supabaseAdmin
      .from("students")
      .update({ name: data.name, roll: data.roll, email, leetcode_id: data.leetcode_id })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });



export const getStudentByRoll = createServerFn({ method: "GET" })
  .inputValidator((d: { roll: string }) => z.object({ roll: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: student, error } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, leetcode_id, classroom_id, last_scraped_at, scrape_error")
      .eq("roll", data.roll)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Not found");
    if (!student) throw new Error("Student not found");

    const [statsRes, recentRes, historyRes, classroomRes] = await Promise.allSettled([
      supabaseAdmin.from("student_stats").select("student_id, avatar, total_solved, total_questions, easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total, acceptance_rate, reputation, ranking, streak, total_active_days, contest_rating, contest_global_ranking, contests_attended, contest_top_percentage, real_name, country, submission_calendar, language_stats, tag_stats, badges").eq("student_id", student.id).maybeSingle(),
      supabaseAdmin.from("recent_submissions").select("title, title_slug, lang, submitted_at").eq("student_id", student.id).order("submitted_at", { ascending: false }).limit(20),
      supabaseAdmin.from("daily_snapshots").select("snapshot_date, total_solved, solved_that_day").eq("student_id", student.id).order("snapshot_date", { ascending: true }),
      supabaseAdmin.from("classrooms").select("id, name").eq("id", student.classroom_id).maybeSingle(),
    ]);

    return {
      student,
      stats: statsRes.status === "fulfilled" ? statsRes.value.data ?? null : null,
      recent: recentRes.status === "fulfilled" ? recentRes.value.data ?? [] : [],
      history: historyRes.status === "fulfilled" ? historyRes.value.data ?? [] : [],
      classroom: classroomRes.status === "fulfilled" ? classroomRes.value.data ?? null : null,
    };
  });

export const refreshStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role === "faculty") {
      const { data: student } = await supabaseAdmin
        .from("students")
        .select("classroom_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!student) throw new Error("Student not found");
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", student.classroom_id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden");
    }
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await supabaseAdmin.from("scrape_runs").insert({
        id: runId, source: "student", student_id: data.id, started_at: startedAt, total_students: 1,
      });
    } catch {}
    try {
      const { scrapeStudentById } = await import("./scrape.server");
      await scrapeStudentById(data.id);
      try { await supabaseAdmin.from("scrape_runs").update({ completed_at: new Date().toISOString(), success_count: 1, failed_count: 0 }).eq("id", runId); } catch {}
      return { ok: true };
    } catch (e) {
      try { await supabaseAdmin.from("scrape_runs").update({ completed_at: new Date().toISOString(), success_count: 0, failed_count: 1, errors: JSON.stringify([String(e)]) }).eq("id", runId); } catch {}
      throw e;
    }
  });

export const refreshClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
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
        .eq("classroom_id", data.id)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden");
    }

    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: "classroom",
      p_classroom_id: data.id,
      p_created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    return { jobId };
  });

export const refreshPlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireAdmin])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: "platform",
      p_created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    return { jobId };
  });


