import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  canAdminister,
  canManageStudents,
  canViewAllClassrooms,
  accessibleClassroomIds,
  assertClassroomAccess,
  assertStudentAccess,
  resolveOptionalViewer,
  viewerHasStudentAccess,
  visibleClassroomsForStudent,
} from "@/lib/authz";
import type { AppRole } from "@/integrations/supabase/types";
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

/**
 * One student, one LeetCode profile.
 *
 * The DB constraint (migration 20260807000001) is case-SENSITIVE — PostgREST can
 * only infer an on_conflict target against an index on the bare column — so every
 * write path normalizes here instead. Without this, `Priya_N` and `priya_n` are two
 * students pointing at one profile, which the scraper then fetches twice.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/** Same treatment for roll, which is the global student identity. */
function normalizeRoll(roll: string): string {
  return roll.trim();
}

/**
 * Which of these students the caller may act on, as one query rather than one
 * `has_student_access` RPC per student.
 */
async function accessibleStudentIds(
  userId: string,
  role: AppRole | null,
  studentIds: string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  if (canViewAllClassrooms(role)) return new Set(studentIds);

  const allowed = await accessibleClassroomIds(userId, role);
  if (allowed === null) return new Set(studentIds);
  if (allowed.length === 0) return new Set();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("classroom_students")
    .select("student_id")
    .in("student_id", studentIds)
    .in("classroom_id", allowed);

  return new Set((data ?? []).map((r) => r.student_id));
}

/** Throws if this handle already belongs to a different student. */
async function assertHandleFree(handle: string, exceptStudentId?: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("students")
    .select("id, roll, name")
    .eq("leetcode_id", normalizeHandle(handle))
    .limit(2);

  const clash = (data ?? []).find((s) => s.id !== exceptStudentId);
  if (clash) {
    throw new Error(
      `LeetCode ID "${normalizeHandle(handle)}" already belongs to ${clash.roll} (${clash.name}). One student, one profile.`,
    );
  }
}

/**
 * Create a student in this classroom, or report that the roll already exists.
 *
 * Returns a discriminated result rather than throwing on a duplicate roll. Now
 * that `roll` identifies the person rather than the person-within-a-classroom,
 * "this roll exists" is no longer an error — it usually means the student is
 * already enrolled elsewhere and should be ADDED to this classroom via
 * addStudentToClassroom. The caller decides.
 */
export const addStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => StudentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertClassroomAccess(userId, role, data.classroom_id);

    const roll = normalizeRoll(data.roll);
    const handle = normalizeHandle(data.leetcode_id);

    // limit(1), not maybeSingle(): until Phase 2 a roll may still map to several
    // rows, and maybeSingle() errors rather than choosing.
    const { data: existingRows } = await supabaseAdmin
      .from("students")
      .select("id, name, leetcode_id")
      .eq("roll", roll)
      .order("created_at", { ascending: true })
      .limit(1);
    const existing = existingRows?.[0];

    if (existing) {
      const { data: here } = await supabaseAdmin
        .from("classroom_students")
        .select("student_id")
        .eq("student_id", existing.id)
        .eq("classroom_id", data.classroom_id)
        .maybeSingle();

      return {
        status: "exists" as const,
        student: { id: existing.id, name: existing.name, leetcode_id: existing.leetcode_id },
        classrooms: (await visibleClassroomsForStudent(userId, role, existing.id)).map((c) => c.name),
        alreadyHere: !!here,
      };
    }

    await assertHandleFree(handle);

    const email = data.email && data.email.length > 0 ? data.email : null;
    const { data: row, error } = await supabaseAdmin
      .from("students")
      .insert({ name: data.name, roll, email, leetcode_id: handle })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") throw new Error(`Roll "${roll}" already exists`);
      throw new Error(error.message);
    }

    const { error: memErr } = await supabaseAdmin
      .from("classroom_students")
      .insert({ student_id: row.id, classroom_id: data.classroom_id });
    if (memErr) {
      // A student with no classroom is invisible everywhere and would never be
      // scraped. Roll the insert back rather than leaving one behind.
      await supabaseAdmin.from("students").delete().eq("id", row.id);
      throw new Error(memErr.message);
    }

    // Scraping is queued, not awaited: awaiting a LeetCode round-trip here used to
    // hang the form and die on the serverless timeout with the student inserted.
    await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: "students",
      p_student_ids: [row.id],
      p_created_by: userId,
    });

    return { status: "created" as const, id: row.id };
  });

/** Enrol an existing student in an additional classroom. */
export const addStudentToClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
    z.object({ studentId: z.string().uuid(), classroomId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    // Both sides: you must own the destination classroom AND already be able to
    // reach the student. Checking only the destination would let anyone pull any
    // student in the directory into their own cohort.
    await assertClassroomAccess(userId, role, data.classroomId);
    await assertStudentAccess(userId, role, data.studentId);

    const { error } = await supabaseAdmin
      .from("classroom_students")
      .upsert(
        { student_id: data.studentId, classroom_id: data.classroomId },
        { onConflict: "classroom_id,student_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type BulkRowError = { roll: string; reason: string };

/**
 * Add many students to one classroom.
 *
 * Two phases, and the first NEVER blind-updates. An upsert keyed on the now-global
 * `roll` would be a cross-classroom write primitive: a faculty member could post a
 * row carrying another cohort's roll and silently overwrite that student's name and
 * LeetCode handle — repointing the scraper — while their own classroom check passed.
 * So existing rolls are only ever ADDED to this classroom, and only when the caller
 * can already reach them; refusals come back per row instead of being swallowed.
 */
export const bulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => BulkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertClassroomAccess(userId, role, data.classroom_id);

    // Dedup within the payload itself; last row wins.
    const keyed = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) keyed.set(normalizeRoll(r.roll), r);
    const rolls = [...keyed.keys()];

    const { data: existingRows, error: lookupErr } = await supabaseAdmin
      .from("students")
      .select("id, roll")
      .in("roll", rolls)
      .order("created_at", { ascending: true });
    if (lookupErr) throw new Error(lookupErr.message);

    // Several rows can share a roll until Phase 2. Map insertion order follows the
    // query's ordering, and `set` overwrites — so order oldest-first and keep the
    // FIRST seen, matching the record getStudentByRoll resolves to.
    const existingByRoll = new Map<string, string>();
    for (const s of existingRows ?? []) {
      if (!existingByRoll.has(s.roll)) existingByRoll.set(s.roll, s.id);
    }
    const reachable = await accessibleStudentIds(
      userId,
      role,
      [...existingByRoll.values()],
    );

    const errors: BulkRowError[] = [];
    const memberFor: string[] = [];      // student ids to enrol here
    const toInsert: {
      name: string; roll: string; email: string | null; leetcode_id: string;
    }[] = [];

    // Handles already taken, so a new row cannot claim one.
    const newHandles = [...keyed.values()]
      .filter((r) => !existingByRoll.has(normalizeRoll(r.roll)))
      .map((r) => normalizeHandle(r.leetcode_id));
    const { data: handleRows } = newHandles.length
      ? await supabaseAdmin.from("students").select("roll, leetcode_id").in("leetcode_id", newHandles)
      : { data: [] as { roll: string; leetcode_id: string }[] };
    const takenHandle = new Map((handleRows ?? []).map((s) => [s.leetcode_id, s.roll]));

    for (const [roll, r] of keyed) {
      const existingId = existingByRoll.get(roll);

      if (existingId) {
        if (!reachable.has(existingId)) {
          errors.push({ roll, reason: "belongs to a cohort you cannot access" });
          continue;
        }
        // Identity fields are deliberately untouched — this only enrols them here.
        memberFor.push(existingId);
        continue;
      }

      const handle = normalizeHandle(r.leetcode_id);
      const owner = takenHandle.get(handle);
      if (owner) {
        errors.push({ roll, reason: `LeetCode ID "${handle}" already belongs to ${owner}` });
        continue;
      }

      toInsert.push({
        name: r.name,
        roll,
        email: r.email && r.email.length > 0 ? r.email : null,
        leetcode_id: handle,
      });
    }

    let created: string[] = [];
    if (toInsert.length > 0) {
      const { data: rows, error } = await supabaseAdmin
        .from("students")
        .insert(toInsert)
        .select("id");
      if (error) throw new Error(error.message);
      created = (rows ?? []).map((r) => r.id);
    }

    // Every accepted row gets a membership, new or existing. This is the step that
    // actually implements "a student in many classrooms".
    const allIds = [...created, ...memberFor];
    if (allIds.length > 0) {
      const { error: memErr } = await supabaseAdmin
        .from("classroom_students")
        .upsert(
          allIds.map((id) => ({ student_id: id, classroom_id: data.classroom_id })),
          { onConflict: "classroom_id,student_id", ignoreDuplicates: true },
        );
      if (memErr) throw new Error(memErr.message);

      await supabaseAdmin.rpc("enqueue_refresh_job", {
        p_scope: "students",
        p_student_ids: allIds,
        p_created_by: userId,
      });
    }

    return {
      inserted: created.length,
      enrolled: memberFor.length,
      skipped: errors.length,
      errors,
    };
  });

/**
 * Remove a student from ONE classroom.
 *
 * Replaces the old `deleteStudent`, which had no UI caller and whose signature
 * (a student id alone) can no longer identify what to remove. The RPC deletes the
 * student outright only when this was their last classroom — see the note there
 * about why this is a function and not a trigger.
 */
export const removeStudentFromClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
    z.object({ studentId: z.string().uuid(), classroomId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");
    await assertClassroomAccess(userId, role, data.classroomId);
    await assertStudentAccess(userId, role, data.studentId);

    const { data: rows, error } = await supabaseAdmin.rpc("remove_student_from_classroom", {
      p_student: data.studentId,
      p_classroom: data.classroomId,
    });
    if (error) throw new Error(error.message);

    const result = Array.isArray(rows) ? rows[0] : rows;
    return {
      studentDeleted: result?.student_deleted ?? false,
      remainingClassrooms: result?.remaining_classrooms ?? 0,
    };
  });

export const updateStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
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

    const { data: current, error: curErr } = await supabaseAdmin
      .from("students")
      .select("roll, leetcode_id")
      .eq("id", data.id)
      .maybeSingle();
    if (curErr || !current) throw new Error("Student not found");

    const roll = normalizeRoll(data.roll);
    const handle = normalizeHandle(data.leetcode_id);

    /*
      `roll` is now the global student identity (it drives the public lookup and
      the import) and `leetcode_id` is what the scraper points at. Changing either
      on a student who belongs to several cohorts affects cohorts the caller may
      not be responsible for, so those two are admin-only in that case. Name and
      email are cosmetic and stay open to any faculty who can reach the student.
    */
    const identityChanged = roll !== current.roll || handle !== current.leetcode_id;
    if (identityChanged && !canAdminister(role)) {
      const { count } = await supabaseAdmin
        .from("classroom_students")
        .select("*", { count: "exact", head: true })
        .eq("student_id", data.id);

      if ((count ?? 0) > 1) {
        const names = (await visibleClassroomsForStudent(userId, role, data.id)).map((c) => c.name);
        throw new Error(
          `This student is in ${count} cohorts${names.length ? ` (${names.join(", ")})` : ""}. Only an admin can change their roll number or LeetCode ID.`,
        );
      }
    }

    if (handle !== current.leetcode_id) await assertHandleFree(handle, data.id);

    const email = data.email && data.email.length > 0 ? data.email : null;
    const { error } = await supabaseAdmin
      .from("students")
      .update({ name: data.name, roll, email, leetcode_id: handle })
      .eq("id", data.id);
    if (error) {
      if (error.code === "23505") throw new Error(`Roll "${roll}" is already taken`);
      throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Public-facing student profile, served to two audiences from one path.
 *
 * Anonymous visitors (and staff with no access to any of the student's classrooms)
 * get an EXACT roll match only — no fuzzy lookup, so the directory cannot be walked
 * — and identity fields come back masked. LeetCode activity is returned in full for
 * everyone, since that is public on leetcode.com anyway.
 *
 * `masked: true` tells the page to hide the outbound profile link, whose href would
 * otherwise give the handle straight back, AND suppresses the cohort list: with
 * memberships that list is itself identifying, so returning it to a masked viewer
 * would be a new leak rather than the same one in a new shape.
 */
export const getStudentByRoll = createServerFn({ method: "GET" })
  .validator((d: { roll: string }) =>
    z.object({ roll: z.string().trim().min(1).max(50) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /*
      `maybeSingle()` would ERROR, not pick one, if a roll still maps to more than
      one student row — which it legitimately does until the duplicates are merged
      and Phase 2 adds UNIQUE(roll). Oldest-first is the original record and is
      stable across requests, so the public profile does not flip between two
      versions of the same person while cleanup is pending.
    */
    const { data: student, error } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, email, leetcode_id, last_scraped_at, scrape_error")
      .eq("roll", data.roll)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Lookup failed");
    if (!student) throw new Error("Student not found");

    const viewer = await resolveOptionalViewer();
    const masked = !(await viewerHasStudentAccess(viewer, student.id));

    const [statsRes, recentRes, historyRes] = await Promise.allSettled([
      supabaseAdmin.from("student_stats").select("student_id, avatar, total_solved, total_questions, easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total, acceptance_rate, reputation, ranking, streak, total_active_days, contest_rating, contest_global_ranking, contests_attended, contest_top_percentage, real_name, country, submission_calendar, language_stats, tag_stats, badges").eq("student_id", student.id).maybeSingle(),
      supabaseAdmin.from("recent_submissions").select("title, title_slug, lang, submitted_at").eq("student_id", student.id).order("submitted_at", { ascending: false }).limit(20),
      supabaseAdmin.from("daily_snapshots").select("snapshot_date, total_solved, solved_that_day").eq("student_id", student.id).order("snapshot_date", { ascending: true }),
    ]);

    const stats = statsRes.status === "fulfilled" ? statsRes.value.data ?? null : null;

    const classrooms = masked || !viewer
      ? []
      : await visibleClassroomsForStudent(viewer.userId, viewer.role, student.id);

    return {
      masked,
      student: masked
        ? {
            id: student.id,
            roll: student.roll,
            name: maskName(student.name),
            email: maskEmail(student.email),
            leetcode_id: maskHandle(student.leetcode_id),
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
      classrooms,
    };
  });

export const refreshStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
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
