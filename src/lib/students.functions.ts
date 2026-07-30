import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  canManageStudents,
  assertClassroomAccess,
  assertStudentAccess,
  resolveOptionalViewer,
  viewerHasClassroomAccess,
} from "@/lib/authz";
import { maskEmail, maskHandle, maskName } from "@/lib/mask";

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
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: unknown) => StudentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertClassroomAccess(userId, role, data.classroom_id);

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

    if (error) {
      // The table is UNIQUE(classroom_id, roll); say so in words rather than
      // leaking a Postgres constraint string into a toast.
      if (error.code === "23505") {
        throw new Error(`Roll "${data.roll}" already exists in this classroom`);
      }
      throw new Error(error.message);
    }

    // Scraping used to be awaited inline here, so the form sat spinning for the
    // length of a LeetCode round-trip and died outright if that exceeded the
    // serverless timeout — with the student already inserted. Queue it instead
    // and let the background pump do the work, exactly like bulkAddStudents.
    await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: "students",
      p_student_ids: [row.id],
      p_created_by: userId,
    });

    return { id: row.id };
  });

export const bulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: unknown) => BulkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertClassroomAccess(userId, role, data.classroom_id);

    const keyed = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) {
      keyed.set(`${data.classroom_id}:${r.roll}`, r);
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
        p_created_by: userId,
      });
    }

    return { inserted: rows?.length ?? 0 };
  });

export const deleteStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertStudentAccess(userId, role, data.id);

    const { error } = await supabaseAdmin.from("students").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
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
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertStudentAccess(userId, role, data.id);

    const email = data.email && data.email.length > 0 ? data.email : null;
    const { error } = await supabaseAdmin
      .from("students")
      .update({ name: data.name, roll: data.roll, email, leetcode_id: data.leetcode_id })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Public-facing student profile, served to two audiences from one path.
 *
 * Anonymous visitors (and staff with no access to the student's classroom) get
 * an EXACT roll match only — no fuzzy lookup, so the directory cannot be walked —
 * and identity fields come back masked. LeetCode activity is returned in full for
 * everyone, since that is public on leetcode.com anyway.
 *
 * `masked: true` tells the page to hide the outbound profile link, whose href
 * would otherwise give the handle straight back.
 */
export const getStudentByRoll = createServerFn({ method: "GET" })
  .inputValidator((d: { roll: string }) =>
    z.object({ roll: z.string().trim().min(1).max(50) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: student, error } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, email, leetcode_id, classroom_id, last_scraped_at, scrape_error")
      .eq("roll", data.roll)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Lookup failed");
    if (!student) throw new Error("Student not found");

    const viewer = await resolveOptionalViewer();
    const masked = !(await viewerHasClassroomAccess(viewer, student.classroom_id));

    const [statsRes, recentRes, historyRes, classroomRes] = await Promise.allSettled([
      supabaseAdmin.from("student_stats").select("student_id, avatar, total_solved, total_questions, easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total, acceptance_rate, reputation, ranking, streak, total_active_days, contest_rating, contest_global_ranking, contests_attended, contest_top_percentage, real_name, country, submission_calendar, language_stats, tag_stats, badges").eq("student_id", student.id).maybeSingle(),
      supabaseAdmin.from("recent_submissions").select("title, title_slug, lang, submitted_at").eq("student_id", student.id).order("submitted_at", { ascending: false }).limit(20),
      supabaseAdmin.from("daily_snapshots").select("snapshot_date, total_solved, solved_that_day").eq("student_id", student.id).order("snapshot_date", { ascending: true }),
      supabaseAdmin.from("classrooms").select("id, name").eq("id", student.classroom_id).maybeSingle(),
    ]);

    const stats = statsRes.status === "fulfilled" ? statsRes.value.data ?? null : null;

    return {
      masked,
      student: masked
        ? {
            id: student.id,
            roll: student.roll,
            name: maskName(student.name),
            email: maskEmail(student.email),
            leetcode_id: maskHandle(student.leetcode_id),
            classroom_id: student.classroom_id,
            last_scraped_at: student.last_scraped_at,
            // A scrape error can quote the raw handle — withhold it, but still
            // let the page know something is wrong.
            scrape_error: student.scrape_error ? "Profile could not be fetched" : null,
          }
        : student,
      // real_name is the student's own name off their LeetCode profile: identity,
      // not activity. Everything else in stats is activity and stays intact.
      stats: stats && masked ? { ...stats, real_name: maskName(stats.real_name) } : stats,
      recent: recentRes.status === "fulfilled" ? recentRes.value.data ?? [] : [],
      history: historyRes.status === "fulfilled" ? historyRes.value.data ?? [] : [],
      classroom: classroomRes.status === "fulfilled" ? classroomRes.value.data ?? null : null,
    };
  });

export const refreshStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertStudentAccess(userId, role, data.id);

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

// `refreshClassroom` and `refreshPlatform` used to live here with their own,
// different role rules than `enqueueRefresh` in refresh-jobs.functions.ts — a
// placement officer could refresh a classroom through one and not the other.
// Both are gone; everything enqueues through `enqueueRefresh`.
