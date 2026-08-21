import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  requireRole,
  canAdminister,
  canManageStudents,
  accessibleClassroomIds,
  assertClassroomAccess,
  assertStudentAccess,
  resolveOptionalViewer,
  viewerHasStudentAccess,
  visibleClassroomsForStudent,
} from "@/lib/authz";
import type { AppRole } from "@/integrations/supabase/app-role";
import { maskEmail, maskHandle, maskName } from "@/lib/mask";
import { requirePublicRateLimit } from "@/lib/rate-limit.server";
import { optionalEmail } from "@/lib/validation";
import type { PlatformRank } from "@/lib/ranks.server";
import type { Json } from "@/integrations/supabase/types";

/**
 * Cap on daily_snapshots rows returned by the PUBLIC profile endpoint.
 *
 * ~2 years of history at one row per day, which is more than any chart on the
 * page renders, while keeping the response bounded on an endpoint that anyone
 * can call. Without a cap this grew by one row per student per platform per day
 * and would eventually hit PostgREST's db-max-rows, which truncates silently.
 */
const PUBLIC_SNAPSHOT_LIMIT = 750;

/**
 * platform id -> handle, for every platform EXCEPT LeetCode.
 *
 * LeetCode stays its own field because students.leetcode_id is still NOT NULL
 * and a trigger mirrors it into the accounts table — accepting it here too would
 * give one value two writers.
 */
const HandlesInput = z.record(z.string().min(1).max(50), z.string().trim().max(100)).optional();

const StudentInput = z.object({
  classroom_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  roll: z.string().trim().min(1).max(50),
  email: optionalEmail,
  leetcode_id: z.string().trim().min(1).max(100),
  handles: HandlesInput,
});

const BulkInput = z.object({
  classroom_id: z.string().uuid(),
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        roll: z.string().trim().min(1).max(50),
        email: optionalEmail,
        leetcode_id: z.string().trim().min(1).max(100),
        handles: HandlesInput,
      }),
    )
    .min(1)
    .max(500),
});

/**
 * A LeetCode handle as it will be STORED: exactly what was typed, trimmed.
 *
 * This used to lower-case, to make `Priya_N` and `priya_n` collide under a
 * case-SENSITIVE unique index. It bought that uniqueness by corrupting the data:
 * LeetCode's `matchedUser` lookup is case-SENSITIVE, so a handle with a capital
 * in it was rewritten into one that does not exist, every scrape failed with
 * "That user does not exist", and the edit form could not fix it — retyping the
 * correct casing normalized straight back to the broken value, the server saw no
 * change, and reported success. Ten students were stuck that way.
 *
 * Uniqueness now comes from `handleKey` below plus a case-insensitive unique
 * index (migration 20260819000001), which is where it always belonged — and it
 * matches how every OTHER platform's handle has always been stored.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim();
}

/**
 * The same handle as a COMPARISON key. Storage preserves case; identity ignores
 * it, so `Priya_N` and `priya_n` are still one profile and cannot be claimed by
 * two students. Mirrors `student_platform_accounts.handle_normalized`, which is
 * a generated column computing exactly this.
 */
export function handleKey(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * Who already holds each of these LeetCode handles, compared case-insensitively.
 *
 * Reads `student_platform_accounts` rather than `students`: `handle_normalized`
 * is the only case-folded, INDEXED copy of a handle in the schema, so this stays
 * an exact `eq`/`in` lookup. Matching `students.leetcode_id` case-insensitively
 * would need `ilike`, whose `_` wildcard is a literal character in half these
 * handles — `suryateja_79` would match `suryateja179`.
 */
export async function ownersByHandleKey(keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: accounts } = await supabaseAdmin
    .from("student_platform_accounts")
    .select("student_id, handle_normalized")
    .eq("platform_id", "leetcode")
    .in("handle_normalized", keys);
  const rows = accounts ?? [];
  if (rows.length === 0) return new Map();

  const { data: owners } = await supabaseAdmin
    .from("students")
    .select("id, roll, name")
    .in(
      "id",
      rows.map((a) => a.student_id),
    );
  const byId = new Map((owners ?? []).map((s) => [s.id, s]));

  const out = new Map<string, string>();
  for (const a of rows) {
    const owner = byId.get(a.student_id);
    if (a.handle_normalized && owner) out.set(a.handle_normalized, owner.roll);
  }
  return out;
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

  /*
    No canViewAllClassrooms short-circuit here.

    It used to return early for placement officers, which bypassed scoping
    entirely — and now that an ASSIGNED placement officer is restricted to their
    colleges, that early return would have quietly reinstated the hole this
    function is supposed to close. accessibleClassroomIds is the single source
    of truth: null still means unrestricted, so the admin path is unchanged.
  */
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

/**
 * Forget what we knew about a platform account, because it now points at a
 * different profile.
 *
 * The scraper refuses any write that drops total_solved by more than 30%
 * (isImplausibleRegression) — a good guard, because a broken parser and an
 * empty profile both say "0 solved" and only the previous row can tell them
 * apart. But it assumes the row it compares against describes the SAME person.
 * Changing a handle breaks that assumption: the stored 265 belongs to the old
 * profile, the new one legitimately has 84, and the guard then rejects every
 * future fetch forever. Students sat frozen with
 * "total_solved dropped 265 -> 84 (>30%)" and no way out.
 *
 * Deleting the stats row removes the stale baseline, so the next scrape writes
 * cleanly and the guard resumes protecting real continuity. Snapshots are left
 * alone deliberately — they are dated history, not a baseline, and the trend
 * chart should still show what happened before the correction.
 */
async function resetPlatformBaseline(studentId: string, platformId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await supabaseAdmin
    .from("platform_stats")
    .delete()
    .eq("student_id", studentId)
    .eq("platform_id", platformId);

  // The account keeps its row but loses every judgement made about the old
  // profile, so a handle that previously 404'd is retried rather than skipped.
  await supabaseAdmin
    .from("student_platform_accounts")
    .update({
      status: "unverified",
      verified_at: null,
      last_fetched_at: null,
      fetch_error: null,
      consecutive_failures: 0,
      sync_cursor: {},
    })
    .eq("student_id", studentId)
    .eq("platform_id", platformId);
}

/**
 * Throws if this handle already belongs to a different student.
 *
 * Case-INSENSITIVE, even though the handle is stored with its case intact:
 * `Priya_N` and `priya_n` are the same LeetCode profile, and letting two
 * students claim one profile is what the old lower-casing was really guarding
 * against. See `normalizeHandle`.
 */
async function assertHandleFree(handle: string, exceptStudentId?: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = handleKey(handle);

  const { data: accounts } = await supabaseAdmin
    .from("student_platform_accounts")
    .select("student_id")
    .eq("platform_id", "leetcode")
    .eq("handle_normalized", key)
    .limit(2);

  const clashId = (accounts ?? []).map((a) => a.student_id).find((id) => id !== exceptStudentId);
  if (!clashId) return;

  const { data: clash } = await supabaseAdmin
    .from("students")
    .select("roll, name")
    .eq("id", clashId)
    .maybeSingle();

  throw new Error(
    `LeetCode ID "${normalizeHandle(handle)}" already belongs to ${clash?.roll ?? "another student"}${
      clash?.name ? ` (${clash.name})` : ""
    }. One student, one profile.`,
  );
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
        classrooms: (await visibleClassroomsForStudent(userId, role, existing.id)).map(
          (c) => c.name,
        ),
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

    // Other-platform handles, written through the same reconciler the edit
    // dialog uses so "add" and "edit" cannot disagree about what a handle change
    // means. Non-fatal: the student and their membership are already committed,
    // and losing the whole insert because CodeChef rejected a duplicate handle
    // would be a worse outcome than one unlinked platform.
    let handleError: string | null = null;
    if (data.handles) {
      try {
        await applyHandleEdits(row.id, data.handles);
      } catch (e) {
        handleError = String((e as Error)?.message ?? e);
      }
    }

    // Scraping is queued, not awaited: awaiting a LeetCode round-trip here used to
    // hang the form and die on the serverless timeout with the student inserted.
    const { enqueueRefreshFanOut } = await import("./refresh-enqueue.server");
    await enqueueRefreshFanOut({
      scope: "students",
      studentIds: [row.id],
      createdBy: userId,
    });

    return { status: "created" as const, id: row.id, handleError };
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
    const reachable = await accessibleStudentIds(userId, role, [...existingByRoll.values()]);

    const errors: BulkRowError[] = [];
    const memberFor: string[] = []; // student ids to enrol here
    const toInsert: {
      name: string;
      roll: string;
      email: string | null;
      leetcode_id: string;
    }[] = [];

    // Handles already taken, so a new row cannot claim one. Keyed case-folded:
    // an upload of `Priya_N` must still collide with a stored `priya_n`.
    const takenHandle = await ownersByHandleKey(
      [...keyed.values()]
        .filter((r) => !existingByRoll.has(normalizeRoll(r.roll)))
        .map((r) => handleKey(r.leetcode_id)),
    );

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
      const owner = takenHandle.get(handleKey(r.leetcode_id));
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
        .select("id, roll");
      if (error) throw new Error(error.message);
      created = (rows ?? []).map((r) => r.id);

      /*
        Other-platform handles for the students this import CREATED.

        Not for existing ones, matching the rule three blocks up: enrolling
        somebody into a second cohort must not rewrite the record they already
        have. applyHandleEdits resets fetch state on a changed handle, which is
        right for a deliberate edit and much too aggressive for a bulk enrol.
      */
      for (const r of rows ?? []) {
        const src = keyed.get(r.roll);
        if (!src?.handles || Object.keys(src.handles).length === 0) continue;
        try {
          await applyHandleEdits(r.id, src.handles);
        } catch (e) {
          errors.push({ roll: r.roll, reason: String((e as Error)?.message ?? e) });
        }
      }
    }

    // Every accepted row gets a membership, new or existing. This is the step that
    // actually implements "a student in many classrooms".
    const allIds = [...created, ...memberFor];
    if (allIds.length > 0) {
      const { error: memErr } = await supabaseAdmin.from("classroom_students").upsert(
        allIds.map((id) => ({ student_id: id, classroom_id: data.classroom_id })),
        { onConflict: "classroom_id,student_id", ignoreDuplicates: true },
      );
      if (memErr) throw new Error(memErr.message);

      const { enqueueRefreshFanOut } = await import("./refresh-enqueue.server");
      await enqueueRefreshFanOut({
        scope: "students",
        studentIds: allIds,
        createdBy: userId,
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

/**
 * Move a student into another cohort, or add them to a second one.
 *
 * Admin-only. Faculty can already add and remove within their own classrooms;
 * this reaches ACROSS cohorts — including into ones the caller may be the only
 * person who can see — so it sits behind `canAdminister` alongside the other
 * cross-cohort operations (roll edits on shared students, hard delete, merge).
 *
 * ── Ordering is load-bearing ───────────────────────────────────────────────
 * The add happens BEFORE the remove, and that is not stylistic.
 * `remove_student_from_classroom` deletes the student outright when the
 * membership it drops was their last one — see its note. Removing first would
 * therefore destroy the student and their entire scrape history mid-move, and
 * the subsequent insert would resurrect a bare row with no stats. Adding first
 * means the student always belongs to at least two cohorts at the moment of
 * removal, so the RPC can only ever drop the membership.
 */
export const moveStudentToClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
    z
      .object({
        studentId: z.string().uuid(),
        toClassroomId: z.string().uuid(),
        /** Omit for a pure add; supply to also drop this membership. */
        fromClassroomId: z.string().uuid().optional(),
        /** "move" drops `fromClassroomId`; "add" keeps both memberships. */
        mode: z.enum(["move", "add"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canAdminister(role)) throw new Error("Only an admin can move students between cohorts");
    if (data.mode === "move" && !data.fromClassroomId) {
      throw new Error("A move needs the cohort to move out of");
    }
    if (data.fromClassroomId === data.toClassroomId) {
      throw new Error("That student is already in this cohort");
    }

    await assertClassroomAccess(userId, role, data.toClassroomId);
    if (data.fromClassroomId) await assertClassroomAccess(userId, role, data.fromClassroomId);
    await assertStudentAccess(userId, role, data.studentId);

    // Upsert, not insert: re-adding someone already in the target cohort is a
    // no-op rather than a duplicate-key error the caller has to interpret.
    const { error: addErr } = await supabaseAdmin.from("classroom_students").upsert(
      { student_id: data.studentId, classroom_id: data.toClassroomId },
      // Same conflict target and ignoreDuplicates as the bulk-add path above,
      // so both routes into a membership behave identically.
      { onConflict: "classroom_id,student_id", ignoreDuplicates: true },
    );
    if (addErr) throw new Error(addErr.message);

    if (data.mode === "add" || !data.fromClassroomId) {
      return { moved: false, added: true, studentDeleted: false };
    }

    const { data: rows, error: rmErr } = await supabaseAdmin.rpc("remove_student_from_classroom", {
      p_student: data.studentId,
      p_classroom: data.fromClassroomId,
    });
    if (rmErr) throw new Error(rmErr.message);

    const result = Array.isArray(rows) ? rows[0] : rows;
    return {
      moved: true,
      added: true,
      // Should always be false given the add above; surfaced so a regression in
      // the RPC's "last cohort" logic is visible rather than silent data loss.
      studentDeleted: result?.student_deleted ?? false,
    };
  });

/**
 * Delete a student outright — every membership, and all their history.
 *
 * Distinct from `removeStudentFromClassroom`, which drops ONE membership and only
 * deletes the student when it was their last. This is for a record that should
 * never have existed: a typo'd duplicate with nothing worth keeping. When the
 * duplicate DOES have history worth keeping, merge instead — that unions it into
 * the survivor rather than throwing it away.
 *
 * Admin-only. Faculty get `removeStudentFromClassroom`, which cannot reach outside
 * their own cohorts.
 */
export const deleteStudentCompletely = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read before deleting so the toast can state what actually went.
    const { data: student } = await supabaseAdmin
      .from("students")
      .select("roll, name")
      .eq("id", data.studentId)
      .maybeSingle();
    if (!student) throw new Error("Student not found");

    const { count: snapshots } = await supabaseAdmin
      .from("daily_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("student_id", data.studentId);

    // student_stats, daily_snapshots, recent_submissions and classroom_students
    // all cascade off students.id.
    const { error } = await supabaseAdmin.from("students").delete().eq("id", data.studentId);
    if (error) throw new Error(error.message);

    return { roll: student.roll, name: student.name, snapshotsDeleted: snapshots ?? 0 };
  });

export type StudentHandleRow = {
  platform_id: string;
  platform_name: string;
  handle: string;
  status: string;
  last_fetched_at: string | null;
  fetch_error: string | null;
  sort_order: number;
  /** False for a platform with no adapter yet — editable, but nothing fetches it. */
  refreshable: boolean;
};

/**
 * A student's platform handles, for the edit dialog.
 *
 * Fetched on demand rather than folded into getClassroom: the cohort payload
 * carries platform STATS, which only exist once a platform has been fetched
 * successfully. A handle that was just typed in — or one whose fetches all
 * failed — has no stats row, so sourcing the editor from that payload would
 * show an empty field for a handle that is really there and silently wipe it on
 * save.
 */
export const getStudentHandles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    await assertStudentAccess(userId, role, data.id);

    const [{ data: accounts }, { data: platforms }] = await Promise.all([
      supabaseAdmin
        .from("student_platform_accounts")
        .select("platform_id, handle, status, last_fetched_at, fetch_error")
        .eq("student_id", data.id),
      supabaseAdmin.from("platforms").select("id, name, enabled, sort_order").order("sort_order"),
    ]);

    const { implementedPlatformIds } = await import("./platforms/registry");
    const implemented = new Set(implementedPlatformIds());

    const held = new Map((accounts ?? []).map((a) => [a.platform_id, a]));

    // Enabled platforms, PLUS any the student already holds a handle on even if
    // that platform was since disabled — hiding an existing handle would make it
    // uneditable and impossible to remove.
    const rows: StudentHandleRow[] = (platforms ?? [])
      .filter((p) => p.enabled || held.has(p.id))
      .map((p) => {
        const a = held.get(p.id);
        return {
          platform_id: p.id,
          platform_name: p.name,
          handle: a?.handle ?? "",
          status: a?.status ?? "none",
          last_fetched_at: a?.last_fetched_at ?? null,
          fetch_error: a?.fetch_error ?? null,
          sort_order: p.sort_order ?? 100,
          refreshable: implemented.has(p.id),
        };
      });

    return { handles: rows };
  });

export const updateStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        roll: z.string().trim().min(1).max(50),
        email: optionalEmail,
        leetcode_id: z.string().trim().min(1).max(100),
        /**
         * platform id -> handle. An empty string REMOVES that platform's account.
         * Omit the field entirely to leave every handle untouched.
         *
         * "leetcode" is ignored here on purpose — students.leetcode_id above is
         * still its source of truth and a trigger (20260808000002) mirrors it
         * into the accounts table. Accepting it in both places would give one
         * value two writers.
         */
        handles: z.record(z.string().min(1).max(50), z.string().trim().max(100)).optional(),
      })
      .parse(d),
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
      `roll` is the global student identity (it drives the public lookup and the
      import) and touches every cohort a shared student belongs to, so it stays
      admin-only once a student is in more than one classroom. LeetCode ID used
      to be gated the same way, but a faculty member who already passed
      assertStudentAccess above for THIS student should be able to fix a
      typo'd handle regardless of how many cohorts it's shared across — that's
      the whole reason a faculty-facing updateStudent exists. Name and email are
      cosmetic and stay open to any faculty who can reach the student.
    */
    const rollChanged = roll !== current.roll;
    if (rollChanged && !canAdminister(role)) {
      const { count } = await supabaseAdmin
        .from("classroom_students")
        .select("*", { count: "exact", head: true })
        .eq("student_id", data.id);

      if ((count ?? 0) > 1) {
        const names = (await visibleClassroomsForStudent(userId, role, data.id)).map((c) => c.name);
        throw new Error(
          `This student is in ${count} cohorts${names.length ? ` (${names.join(", ")})` : ""}. Only an admin can change their roll number.`,
        );
      }
    }

    if (handle !== current.leetcode_id) await assertHandleFree(handle, data.id);

    const email = data.email && data.email.length > 0 ? data.email : null;

    /*
      `.select()` so the write reports what it actually touched.

      A bare `.update()` returns 204 with no error when it matches nothing, so a
      save that changed no row was indistinguishable from one that did — and the
      UI showed a green "Student updated" either way. That is how the
      lower-casing bug stayed invisible for as long as it did.
    */
    const { data: updated, error } = await supabaseAdmin
      .from("students")
      .update({ name: data.name, roll, email, leetcode_id: handle })
      .eq("id", data.id)
      .select("id, roll, leetcode_id");
    if (error) {
      // Two unique indexes can raise this now: roll, and the case-insensitive
      // LeetCode handle added in 20260819000001. Naming the wrong one sends
      // whoever hit it looking for a roll clash that does not exist.
      if (error.code === "23505") {
        throw new Error(
          /leetcode/i.test(`${error.message} ${(error as { details?: string }).details ?? ""}`)
            ? `LeetCode ID "${handle}" already belongs to another student. One student, one profile.`
            : `Roll "${roll}" is already taken`,
        );
      }
      throw new Error(error.message);
    }

    // Never report a write that reached no row as success.
    if (!updated || updated.length === 0) {
      throw new Error("The update did not reach any row — nothing was saved. Please report this.");
    }

    if (handle !== current.leetcode_id) await resetPlatformBaseline(data.id, "leetcode");

    const handleChanges = data.handles ? await applyHandleEdits(data.id, data.handles) : null;

    return { ok: true, handles: handleChanges };
  });

/**
 * Reconcile a student's non-LeetCode platform accounts against the submitted map.
 *
 * Diffed rather than upserted wholesale, because the row carries fetch STATE as
 * well as the handle. Blindly upserting would reset `consecutive_failures` and
 * `sync_cursor` on every save even when nothing changed — and for Codeforces
 * that cursor is what stops the adapter re-walking ~1.3MB of submission history
 * on the next run.
 *
 * When a handle genuinely CHANGES, the opposite applies: the state belongs to
 * the old account and every part of it is wrong for the new one, so it is
 * cleared deliberately.
 */
async function applyHandleEdits(studentId: string, submitted: Record<string, string>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const entries = Object.entries(submitted).filter(([platformId]) => platformId !== "leetcode");
  if (entries.length === 0) return { added: 0, updated: 0, removed: 0 };

  const { data: knownPlatforms } = await supabaseAdmin
    .from("platforms")
    .select("id")
    .in(
      "id",
      entries.map(([id]) => id),
    );
  const known = new Set((knownPlatforms ?? []).map((p) => p.id));

  const { data: existing } = await supabaseAdmin
    .from("student_platform_accounts")
    .select("id, platform_id, handle")
    .eq("student_id", studentId);
  const current = new Map((existing ?? []).map((a) => [a.platform_id, a]));

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [platformId, rawHandle] of entries) {
    if (!known.has(platformId)) continue; // unknown platform id: ignore, don't fail the save
    const handle = rawHandle.trim();
    const row = current.get(platformId);

    if (!handle) {
      if (row) {
        const { error } = await supabaseAdmin
          .from("student_platform_accounts")
          .delete()
          .eq("id", row.id);
        if (error) throw new Error(`Could not remove ${platformId} handle: ${error.message}`);
        removed += 1;
      }
      continue;
    }

    if (row) {
      // Case-insensitive: handle_normalized is what the unique index uses, so
      // "Foo" -> "foo" is not a change worth resetting fetch state over.
      if (row.handle.trim().toLowerCase() === handle.toLowerCase()) {
        if (row.handle !== handle) {
          const { error } = await supabaseAdmin
            .from("student_platform_accounts")
            .update({ handle })
            .eq("id", row.id);
          if (error) throw new Error(`Could not update ${platformId} handle: ${error.message}`);
          updated += 1;
        }
        continue;
      }

      const { error } = await supabaseAdmin
        .from("student_platform_accounts")
        .update({
          handle,
          // A different account entirely — none of the old state describes it.
          status: "unverified",
          verified_at: null,
          last_fetched_at: null,
          fetch_error: null,
          consecutive_failures: 0,
          sync_cursor: {},
        })
        .eq("id", row.id);
      if (error) throw handleAccountError(error, platformId, handle);
      // ...including the stats row, whose total_solved is the baseline the
      // scraper's regression guard compares against. Left in place it belongs
      // to the previous profile and freezes this account permanently.
      await resetPlatformBaseline(studentId, platformId);
      updated += 1;
      continue;
    }

    const { error } = await supabaseAdmin
      .from("student_platform_accounts")
      .insert({ student_id: studentId, platform_id: platformId, handle, status: "unverified" });
    if (error) throw handleAccountError(error, platformId, handle);
    added += 1;
  }

  return { added, updated, removed };
}

function handleAccountError(
  error: { code?: string; message: string },
  platform: string,
  handle: string,
) {
  // unique (platform_id, handle_normalized) — someone else already claims it.
  if (error.code === "23505") {
    return new Error(`"${handle}" is already linked to another student on ${platform}`);
  }
  return new Error(`Could not save ${platform} handle: ${error.message}`);
}

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
/**
 * One platform's worth of a student's profile.
 *
 * Declared explicitly because the nested PostgREST select behind it nests deeply
 * enough that TypeScript abandons inference and the entire server function's
 * return type degrades to `unknown` — which then fails at every call site with a
 * message that points at the route, not at the query.
 */
export type PlatformStatsSummary = {
  total_solved: number | null;
  easy_solved: number | null;
  medium_solved: number | null;
  hard_solved: number | null;
  unrated_solved: number | null;
  rating: number | null;
  max_rating: number | null;
  global_rank: number | null;
  country_rank: number | null;
  institute_rank: number | null;
  platform_score: number | null;
  stars: number | null;
  streak: number | null;
  contests_attended: number | null;
  fetch_status: string | null;
  fetched_at: string | null;
  /**
   * Platform-specific extras (calendars, tag/language breakdowns, contest
   * history). Typed as the generated `Json` rather than
   * Record<string, unknown>: `unknown` is not inferable across the server-fn
   * boundary and collapses the whole return type.
   */
  data: Json | null;
};

export type PlatformSnapshot = {
  snapshot_date: string;
  total_solved: number;
  solved_that_day: number;
};

export type PlatformSubmission = {
  title: string;
  title_slug: string;
  lang: string | null;
  submitted_at: string;
};

export type StudentPlatformSummary = {
  platform_id: string;
  name: string;
  sort_order: number;
  rank_metric: string;
  handle: string;
  profile_url: string | null;
  status: string;
  last_fetched_at: string | null;
  fetch_error: string | null;
  stats: PlatformStatsSummary | null;
  /** Drives the "not enabled yet" vs "no adapter" distinction on the panel. */
  enabled: boolean;
  /**
   * This platform's OWN history. Both of these used to be fetched once,
   * unfiltered, and rendered under the LeetCode tab — but daily_snapshots is
   * keyed (student_id, platform_id, snapshot_date), so a student on four
   * platforms produced four rows per date and the "Solved Over Time" chart was
   * plotting every platform interleaved on one axis. Same for recent
   * submissions, which carry a platform_id and were being mixed together.
   */
  history: PlatformSnapshot[];
  recent: PlatformSubmission[];
  rank: {
    metric: string;
    value: number | null;
    college_rank: number;
    college_total: number;
    overall_rank: number;
    overall_total: number;
  } | null;
  score_contribution: number | null;
};

/**
 * Per-platform accounts and their stats for one student.
 *
 * Extracted into its own function with an EXPLICIT return type as a type
 * firewall. Inlined, the nested PostgREST select below nests deeply enough that
 * TypeScript gives up and degrades the entire enclosing server function's return
 * type to `unknown` — every consumer then fails with an error pointing at the
 * route rather than at this query.
 *
 * Handles are masked for anonymous visitors for the same reason the LeetCode one
 * is: a handle links this page to a person's real accounts elsewhere. The
 * NUMBERS stay visible — they are already public on each platform, which is the
 * entire basis for publishing them here.
 */
async function loadStudentPlatforms(
  studentId: string,
  masked: boolean,
  rankRow: { platform_ranks: PlatformRank[]; score_breakdown: Record<string, number> } | null,
): Promise<StudentPlatformSummary[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data }, { data: snaps }, { data: subs }] = await Promise.all([
    supabaseAdmin
      .from("student_platform_accounts")
      .select(
        "id, platform_id, handle, status, last_fetched_at, fetch_error, " +
          "platforms(name, profile_url_template, sort_order, rank_metric, enabled), " +
          "platform_stats(total_solved, easy_solved, medium_solved, hard_solved, unrated_solved, " +
          "rating, max_rating, global_rank, country_rank, institute_rank, platform_score, stars, " +
          "streak, contests_attended, fetch_status, fetched_at, data)",
      )
      .eq("student_id", studentId),
    // platform_id is SELECTED here so the rows can be grouped below. Fetching
    // these once for the student and splitting in JS beats a query per platform.
    supabaseAdmin
      .from("daily_snapshots")
      .select("platform_id, snapshot_date, total_solved, solved_that_day")
      .eq("student_id", studentId)
      .order("snapshot_date", { ascending: true }),
    supabaseAdmin
      .from("recent_submissions")
      .select("platform_id, title, title_slug, lang, submitted_at")
      .eq("student_id", studentId)
      .order("submitted_at", { ascending: false }),
  ]);

  const historyByPlatform = new Map<string, PlatformSnapshot[]>();
  for (const s of snaps ?? []) {
    const list = historyByPlatform.get(s.platform_id) ?? [];
    list.push({
      snapshot_date: s.snapshot_date,
      total_solved: s.total_solved,
      solved_that_day: s.solved_that_day,
    });
    historyByPlatform.set(s.platform_id, list);
  }

  const recentByPlatform = new Map<string, PlatformSubmission[]>();
  for (const r of subs ?? []) {
    const list = recentByPlatform.get(r.platform_id) ?? [];
    // Capped per platform, not overall — a chatty LeetCode account would
    // otherwise consume the whole budget and leave the others empty.
    if (list.length < 20) {
      list.push({
        title: r.title,
        title_slug: r.title_slug,
        lang: r.lang,
        submitted_at: r.submitted_at,
      });
    }
    recentByPlatform.set(r.platform_id, list);
  }

  const rankByPlatform = new Map((rankRow?.platform_ranks ?? []).map((p) => [p.platform_id, p]));
  const rows = (data ?? []) as unknown as {
    platform_id: string;
    handle: string;
    status: string;
    last_fetched_at: string | null;
    fetch_error: string | null;
    platforms: {
      name: string;
      profile_url_template: string;
      sort_order: number;
      rank_metric: string;
      enabled: boolean;
    } | null;
    platform_stats: PlatformStatsSummary | null;
  }[];

  return rows
    .map((a): StudentPlatformSummary => {
      const meta = a.platforms;
      const r = rankByPlatform.get(a.platform_id);
      return {
        platform_id: a.platform_id,
        name: meta?.name ?? a.platform_id,
        sort_order: meta?.sort_order ?? 100,
        rank_metric: meta?.rank_metric ?? "solved",
        handle: masked ? maskHandle(a.handle) : a.handle,
        profile_url:
          masked || !meta?.profile_url_template
            ? null
            : meta.profile_url_template.replace("{handle}", encodeURIComponent(a.handle)),
        status: a.status,
        last_fetched_at: a.last_fetched_at,
        // A fetch error can quote the raw handle.
        fetch_error: masked
          ? a.fetch_error
            ? "Profile could not be fetched"
            : null
          : a.fetch_error,
        stats: a.platform_stats,
        enabled: meta?.enabled ?? false,
        history: historyByPlatform.get(a.platform_id) ?? [],
        recent: recentByPlatform.get(a.platform_id) ?? [],
        rank: r
          ? {
              metric: r.metric,
              value: r.value,
              college_rank: r.college_rank,
              college_total: r.college_total,
              overall_rank: r.overall_rank,
              overall_total: r.overall_total,
            }
          : null,
        score_contribution: rankRow?.score_breakdown?.[a.platform_id] ?? null,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

export const getStudentByRoll = createServerFn({ method: "GET" })
  .validator((d: { roll: string }) => z.object({ roll: z.string().trim().min(1).max(50) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /*
      Public endpoint: a student can look themselves up by roll with no account,
      and that flow is worth keeping. But rolls are near-sequential, so unmetered
      access means the directory is walkable one request at a time regardless of
      masking. Staff are exempt — they are authenticated and already scoped.
      See src/lib/rate-limit.server.ts.
    */
    const viewer = await resolveOptionalViewer();
    if (!viewer?.role) await requirePublicRateLimit("profile");

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

    const masked = !(await viewerHasStudentAccess(viewer, student.id));

    const [statsRes, recentRes, historyRes] = await Promise.allSettled([
      supabaseAdmin
        .from("student_stats")
        .select(
          "student_id, avatar, total_solved, total_questions, easy_solved, easy_total, medium_solved, medium_total, hard_solved, hard_total, acceptance_rate, reputation, ranking, streak, total_active_days, contest_rating, contest_global_ranking, contests_attended, contest_top_percentage, real_name, country, submission_calendar, language_stats, tag_stats, badges",
        )
        .eq("student_id", student.id)
        .maybeSingle(),
      supabaseAdmin
        .from("recent_submissions")
        .select("title, title_slug, lang, submitted_at")
        .eq("student_id", student.id)
        .order("submitted_at", { ascending: false })
        .limit(20),
      /*
        Bounded deliberately. This read had no limit, on a public endpoint, over
        a table that gains one row per student per platform per day — so the
        response grew without bound and would eventually be truncated silently by
        PostgREST's db-max-rows (wrong numbers, not an error).

        Newest-first + a hard cap, re-sorted ascending below, so the window stays
        fixed at "the most recent SNAPSHOT_LIMIT days" instead of whatever the
        server happened to return.
      */
      supabaseAdmin
        .from("daily_snapshots")
        .select("snapshot_date, total_solved, solved_that_day")
        .eq("student_id", student.id)
        .order("snapshot_date", { ascending: false })
        .limit(PUBLIC_SNAPSHOT_LIMIT),
    ]);

    const legacyStats = statsRes.status === "fulfilled" ? (statsRes.value.data ?? null) : null;

    const classrooms =
      masked || !viewer
        ? []
        : await visibleClassroomsForStudent(viewer.userId, viewer.role, student.id);

    /*
      Ranks are shown to everyone, including anonymous visitors — they are derived
      entirely from problems solved, which this page already publishes in full
      because it is public on leetcode.com anyway.

      Per-cohort ranks are the exception: each one carries a classroom NAME, and
      cohort membership is exactly what masking withholds. A masked viewer gets the
      college rank and nothing that says which class the student is in.
    */
    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const rankRow = (await fetchStudentRanks([student.id])).get(student.id) ?? null;
    const ranks = rankRow
      ? {
          almanac_score: rankRow.almanac_score,
          score_breakdown: rankRow.score_breakdown,
          college_id: rankRow.college_id,
          // The college NAME is institutional, not personal, and the public
          // profile already publishes the college rank — withholding only the
          // label would make "#3 of 420" meaningless without hiding anything.
          college_name: rankRow.college_name,
          college_rank: rankRow.college_rank,
          college_total: rankRow.college_total,
          overall_rank: rankRow.overall_rank,
          overall_total: rankRow.overall_total,
          platform_ranks: rankRow.platform_ranks,
          classroom_ranks: masked
            ? []
            : rankRow.classroom_ranks.filter((r) =>
                classrooms.some((c) => c.id === r.classroom_id),
              ),
        }
      : null;

    const platforms = await loadStudentPlatforms(student.id, masked, rankRow);

    /*
      LeetCode stats, preferring platform_stats over student_stats.

      Both tables hold LeetCode data during the transition, but only
      platform_stats is still written — the multi-platform worker stopped
      updating student_stats. A student created after that changeover has no
      student_stats row at all, which rendered this page with a populated
      LeetCode card sitting directly above a "Total Solved 0 of 0" panel and an
      empty heatmap.

      Reading the fresher table and falling back to the legacy one keeps both
      populations correct without a schema change, and becomes a no-op once
      student_stats is swapped for a view over platform_stats.
    */
    const lc = platforms.find((p) => p.platform_id === "leetcode");
    const lcDetail = (lc?.stats?.data ?? {}) as Record<string, unknown>;
    const stats = lc?.stats
      ? {
          student_id: student.id,
          real_name: legacyStats?.real_name ?? null,
          avatar: legacyStats?.avatar ?? null,
          country: legacyStats?.country ?? null,
          total_solved: lc.stats.total_solved,
          easy_solved: lc.stats.easy_solved,
          medium_solved: lc.stats.medium_solved,
          hard_solved: lc.stats.hard_solved,
          streak: lc.stats.streak,
          ranking: lc.stats.global_rank,
          contest_rating: lc.stats.rating,
          contests_attended: lc.stats.contests_attended,
          total_questions:
            (lcDetail.total_questions as number) ?? legacyStats?.total_questions ?? null,
          easy_total: (lcDetail.easy_total as number) ?? legacyStats?.easy_total ?? null,
          medium_total: (lcDetail.medium_total as number) ?? legacyStats?.medium_total ?? null,
          hard_total: (lcDetail.hard_total as number) ?? legacyStats?.hard_total ?? null,
          acceptance_rate:
            (lcDetail.acceptance_rate as number) ?? legacyStats?.acceptance_rate ?? null,
          reputation: (lcDetail.reputation as number) ?? legacyStats?.reputation ?? null,
          total_active_days:
            (lcDetail.total_active_days as number) ?? legacyStats?.total_active_days ?? null,
          contest_global_ranking:
            (lcDetail.contest_global_ranking as number) ??
            legacyStats?.contest_global_ranking ??
            null,
          contest_top_percentage:
            (lcDetail.contest_top_percentage as number) ??
            legacyStats?.contest_top_percentage ??
            null,
          submission_calendar:
            lcDetail.submission_calendar ?? legacyStats?.submission_calendar ?? null,
          language_stats: lcDetail.language_stats ?? legacyStats?.language_stats ?? null,
          tag_stats: lcDetail.tag_stats ?? legacyStats?.tag_stats ?? null,
          badges: lcDetail.badges ?? legacyStats?.badges ?? null,
        }
      : legacyStats;

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
      recent: recentRes.status === "fulfilled" ? (recentRes.value.data ?? []) : [],
      // Fetched newest-first so the cap keeps the most RECENT window; the chart
      // consumes it oldest-first, so flip it back here.
      history:
        historyRes.status === "fulfilled"
          ? [...(historyRes.value.data ?? [])].sort((a, b) =>
              a.snapshot_date.localeCompare(b.snapshot_date),
            )
          : [],
      classrooms,
      ranks,
      platforms,
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
      // scrape_runs.student_id did not exist until 20260808000005, so this
      // insert failed with 42703 and the empty catch swallowed it — a
      // single-student refresh never once appeared in Scrape History.
      await supabaseAdmin.from("scrape_runs").insert({
        id: runId,
        source: "student",
        student_id: data.id,
        started_at: startedAt,
        total_students: 1,
      });
    } catch (e) {
      // Bookkeeping only — a failure here must not block the refresh itself.
      // Logged rather than swallowed: the silent version of this catch is what
      // hid the 42703 described above.
      console.warn("[refresh] could not open scrape_runs row:", e);
    }
    /*
      Platform accounts FIRST, then the legacy LeetCode scrape.

      Order matters. scrapeStudentById throws when the handle is bad, and it used
      to be the only thing this button did — so a student whose platform_stats
      row had just been deleted by a handle correction could never get it back:
      the only code path that writes that table was never reached. Running the
      account refresh ahead of it means a legacy failure can no longer skip it.

      Both still run, and on LeetCode that is two fetches. Deliberate for now:
      student_stats is where the profile page still reads avatar, real name and
      country from, and dropping the legacy pass would blank those. It goes away
      when student_stats becomes a view over platform_stats.
    */
    const { refreshStudentPlatforms } = await import("./refresh-student.server");
    const platforms = await refreshStudentPlatforms(data.id);

    try {
      const { scrapeStudentById } = await import("./scrape.server");
      await scrapeStudentById(data.id);
      try {
        await supabaseAdmin
          .from("scrape_runs")
          .update({ completed_at: new Date().toISOString(), success_count: 1, failed_count: 0 })
          .eq("id", runId);
      } catch (e) {
        console.warn("[refresh] could not close scrape_runs row (success):", e);
      }
      return { ok: true, platforms };
    } catch (e) {
      try {
        await supabaseAdmin
          .from("scrape_runs")
          .update({
            completed_at: new Date().toISOString(),
            success_count: 0,
            failed_count: 1,
            errors: JSON.stringify([String(e)]),
          })
          .eq("id", runId);
      } catch (bookkeepingError) {
        console.warn("[refresh] could not close scrape_runs row (failure):", bookkeepingError);
      }
      /*
        Only rethrow if the platform pass got nothing either.

        A dead students.leetcode_id with a working platform account is exactly
        the state a half-finished handle correction leaves behind. Throwing here
        would report "refresh failed" over a refresh that just repopulated the
        roster — and the user would press it again forever.
      */
      if (platforms.some((p) => p.ok)) return { ok: true, platforms };
      throw e;
    }
  });
