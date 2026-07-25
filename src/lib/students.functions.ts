import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      await scrapeStudent(row.id);
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

    const payload = data.rows.map((r) => ({
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
    const INLINE_SCRAPE_LIMIT = 5;
    for (const r of (rows ?? []).slice(0, INLINE_SCRAPE_LIMIT)) {
      try {
        await scrapeStudent(r.id);
        await new Promise((res) => setTimeout(res, 1500));
      } catch (e) {
        console.error(`Scrape failed for ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
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

    const [{ data: stats }, { data: recent }, { data: history }, { data: classroom }] = await Promise.all([
      supabaseAdmin.from("student_stats").select("student_id, avatar, total_solved, total_questions, easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total, acceptance_rate, reputation, ranking, streak, total_active_days, contest_rating, contest_global_ranking, contests_attended, contest_top_percentage, real_name, country, submission_calendar, language_stats, tag_stats, badges").eq("student_id", student.id).maybeSingle(),
      supabaseAdmin.from("recent_submissions").select("title, title_slug, lang, submitted_at").eq("student_id", student.id).order("submitted_at", { ascending: false }).limit(20),
      supabaseAdmin.from("daily_snapshots").select("snapshot_date, total_solved, solved_that_day").eq("student_id", student.id).order("snapshot_date", { ascending: true }),
      supabaseAdmin.from("classrooms").select("id, name").eq("id", student.classroom_id).maybeSingle(),
    ]);

    return { student, stats, recent: recent ?? [], history: history ?? [], classroom };
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
    await scrapeStudent(data.id);
    return { ok: true };
  });

export const refreshClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; force?: boolean }) => z.object({ id: z.string().uuid(), force: z.boolean().optional() }).parse(d))
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

    // Try to acquire the global refresh lock
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60 * 1000); // 10 minute TTL

    // Best-effort check: see if another refresh is running
    const { data: existingLock } = await supabaseAdmin
      .from("refresh_locks")
      .select("classroom_id, started_by, started_at, expires_at")
      .eq("lock_key", "global")
      .maybeSingle();

    if (existingLock && new Date(existingLock.expires_at) > now && !data.force) {
      const { data: classroom } = await supabaseAdmin
        .from("classrooms")
        .select("name")
        .eq("id", existingLock.classroom_id)
        .maybeSingle();
      throw JSON.stringify({
        code: "REFRESH_BUSY",
        busyClassroomId: existingLock.classroom_id,
        busyClassroomName: classroom?.name ?? "Unknown",
        startedBy: existingLock.started_by,
        startedAt: existingLock.started_at,
      });
    }

    // Atomic acquire/replace via upsert (eliminates delete+insert race)
    await supabaseAdmin.from("refresh_locks").upsert({
      lock_key: "global",
      classroom_id: data.id,
      started_by: context.userId,
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
    }, { onConflict: "lock_key" });

    try {
      const { data: students } = await supabaseAdmin
        .from("students")
        .select("id")
        .eq("classroom_id", data.id);
      let ok = 0;
      let failed = 0;
      for (const s of students ?? []) {
        try {
          await scrapeStudent(s.id);
          ok += 1;
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) {
          console.error(`Scrape failed for ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
          failed += 1;
        }
      }
      return { ok, failed };
    } finally {
      await supabaseAdmin.from("refresh_locks").delete().eq("lock_key", "global");
    }
  });

export const refreshPlatform = createServerFn({ method: "POST" })
  .validator((d: { force?: boolean } = {}) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (roles?.role !== "admin") {
      throw new Error("Unauthorized: Admins only");
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour TTL for global

    const { data: existingLock } = await supabaseAdmin
      .from("refresh_locks")
      .select("started_by, started_at, expires_at")
      .eq("lock_key", "global_all")
      .maybeSingle();

    if (existingLock && new Date(existingLock.expires_at) > now && !data.force) {
      throw JSON.stringify({
        code: "REFRESH_BUSY",
        busyClassroomId: null,
        busyClassroomName: "Platform",
        startedBy: existingLock.started_by,
        startedAt: existingLock.started_at,
      });
    }

    const { data: firstClassroom } = await supabaseAdmin.from("classrooms").select("id").limit(1).maybeSingle();
    if (!firstClassroom) return { ok: 0, failed: 0 };

    await supabaseAdmin.from("refresh_locks").upsert({
      lock_key: "global_all",
      classroom_id: firstClassroom.id,
      started_by: context.userId,
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
    }, { onConflict: "lock_key" });

    try {
      const { data: students } = await supabaseAdmin.from("students").select("id");
      let ok = 0;
      let failed = 0;
      for (const s of students ?? []) {
        try {
          await scrapeStudent(s.id);
          ok += 1;
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) {
          console.error(`Scrape failed for ${s.id}: ${e instanceof Error ? e.message : String(e)}`);
          failed += 1;
        }
      }
      return { ok, failed };
    } finally {
      await supabaseAdmin.from("refresh_locks").delete().eq("lock_key", "global_all");
    }
  });

// --- internal helper ---
async function scrapeStudent(id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { fetchLeetCodeProfile } = await import("./leetcode.server");

  const { data: student, error } = await supabaseAdmin
    .from("students")
    .select("id, leetcode_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!student) throw new Error("Student not found");

  try {
    const p = await fetchLeetCodeProfile(student.leetcode_id);

    await supabaseAdmin.from("student_stats").upsert({
      student_id: id,
      real_name: p.realName,
      avatar: p.avatar,
      country: p.country,
      reputation: p.reputation,
      ranking: p.ranking,
      total_solved: p.totalSolved,
      total_questions: p.totalQuestions,
      easy_solved: p.easySolved,
      easy_total: p.easyTotal,
      medium_solved: p.mediumSolved,
      medium_total: p.mediumTotal,
      hard_solved: p.hardSolved,
      hard_total: p.hardTotal,
      acceptance_rate: p.acceptanceRate,
      streak: p.streak,
      total_active_days: p.totalActiveDays,
      contest_rating: p.contestRating,
      contest_global_ranking: p.contestGlobalRanking,
      contests_attended: p.contestsAttended,
      contest_top_percentage: p.contestTopPercentage,
      submission_calendar: p.submissionCalendar,
      language_stats: p.languageStats,
      tag_stats: p.tagStats,
      badges: p.badges,
      updated_at: new Date().toISOString(),
    });

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const { data: prev } = await supabaseAdmin
      .from("daily_snapshots")
      .select("total_solved")
      .eq("student_id", id)
      .lt("snapshot_date", dateStr)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const solvedThatDay = Math.max(0, p.totalSolved - (prev?.total_solved ?? p.totalSolved));
    await supabaseAdmin.from("daily_snapshots").upsert({
      student_id: id,
      snapshot_date: dateStr,
      total_solved: p.totalSolved,
      easy_solved: p.easySolved,
      medium_solved: p.mediumSolved,
      hard_solved: p.hardSolved,
      solved_that_day: solvedThatDay,
    });

    await supabaseAdmin.from("recent_submissions").delete().eq("student_id", id);
    if (p.recent.length) {
      await supabaseAdmin.from("recent_submissions").insert(
        p.recent.map((r) => ({
          student_id: id,
          title: r.title,
          title_slug: r.titleSlug,
          lang: r.lang,
          submitted_at: r.submittedAt,
        })),
      );
    }

    await supabaseAdmin
      .from("students")
      .update({ last_scraped_at: new Date().toISOString(), scrape_error: null })
      .eq("id", id);
  } catch (e: any) {
    await supabaseAdmin
      .from("students")
      .update({ last_scraped_at: new Date().toISOString(), scrape_error: String(e?.message ?? e).slice(0, 300) })
      .eq("id", id);
    throw e;
  }
}
