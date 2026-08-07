import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";

/** The worker gives up on a student after this many consecutive failures. */
export const FAILURE_CUTOFF = 5;

export const listScrapeRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export type FailedStudent = {
  id: string;
  name: string;
  roll: string;
  leetcode_id: string;
  /** A student may be in several cohorts, so this is a list. */
  classroom_names: string[];
  scrape_error: string | null;
  consecutive_failures: number;
  last_scraped_at: string | null;
  /** True once the worker has given up on this student entirely. */
  abandoned: boolean;
};

/**
 * Who is currently failing, and why. The run table only ever carried aggregate
 * counts and an opaque `errors` blob, so "12 failed" was the end of the trail —
 * this reads the per-student error the scraper already records.
 */
export const listFailedStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async (): Promise<FailedStudent[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("students")
      .select("id, name, roll, leetcode_id, scrape_error, consecutive_failures, last_scraped_at")
      .or("consecutive_failures.gt.0,scrape_error.not.is.null")
      .order("consecutive_failures", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return [];

    // A student can be in several cohorts, so this is a list. The old
    // `classrooms(name)` embed became a to-many array after the FK was dropped and
    // would have silently rendered blank on every row — it was read through a cast,
    // so nothing would have complained.
    const { data: memberships } = await supabaseAdmin
      .from("classroom_students")
      .select("student_id, classrooms(name)")
      .in(
        "student_id",
        data.map((s) => s.id),
      );

    const namesByStudent = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const name = (m.classrooms as { name: string } | null)?.name;
      if (!name) continue;
      const list = namesByStudent.get(m.student_id);
      if (list) list.push(name);
      else namesByStudent.set(m.student_id, [name]);
    }

    return data.map((s) => ({
      id: s.id,
      name: s.name,
      roll: s.roll,
      leetcode_id: s.leetcode_id,
      classroom_names: (namesByStudent.get(s.id) ?? []).sort(),
      scrape_error: s.scrape_error,
      consecutive_failures: s.consecutive_failures,
      last_scraped_at: s.last_scraped_at,
      abandoned: s.consecutive_failures >= FAILURE_CUTOFF,
    }));
  });

export type DuplicateStudent = {
  id: string;
  roll: string;
  name: string;
  email: string | null;
  leetcode_id: string;
  total_solved: number;
  snapshot_count: number;
  last_scraped_at: string | null;
  classrooms: string[];
};

/** Which identity key these students collide on. */
export type DuplicateKind = "roll" | "leetcode_id";

export type DuplicateGroup = {
  kind: DuplicateKind;
  value: string;
  student_count: number;
  students: DuplicateStudent[];
};

/**
 * Students colliding on an identity key — the same roll number, or the same
 * LeetCode handle.
 *
 * Both are the same problem with the same two fixes. Duplicate ROLLS are the
 * bigger group right after migrating: before `classroom_students` existed, the
 * only way to put a student in two classrooms was two student rows sharing a
 * roll, which also meant scraping one LeetCode profile twice into two divergent
 * histories. Duplicate HANDLES are a data-entry issue with the same consequence.
 *
 * Neither key is constrained in the database until migration 20260807000001, and
 * that migration aborts on anything still listed here — so this screen is the
 * gate between Phase 1 and Phase 2.
 */
export const listDuplicateStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async (): Promise<DuplicateGroup[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.rpc("duplicate_students");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      kind: row.kind as DuplicateKind,
      value: row.value,
      student_count: row.student_count,
      students: (row.students as unknown as DuplicateStudent[]) ?? [],
    }));
  });

/**
 * Fold one student into another after confirming they are the same person.
 *
 * Destructive and irreversible: the loser's row is deleted. Memberships and
 * snapshot history are unioned into the survivor first, so the merge never leaves
 * a hole in the Daily Matrix.
 */
export const mergeStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z.object({ survivorId: z.string().uuid(), loserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.survivorId === data.loserId) throw new Error("Pick two different students");

    // Re-verify against live data. The screen may have been open while somebody
    // else fixed one of the handles, and merging two unrelated students destroys
    // one of them permanently.
    const { data: pair, error: pairErr } = await supabaseAdmin
      .from("students")
      .select("id, roll, leetcode_id")
      .in("id", [data.survivorId, data.loserId]);
    if (pairErr) throw new Error(pairErr.message);
    if (!pair || pair.length !== 2) throw new Error("One of these students no longer exists");

    const norm = (v: string) => v.trim().toLowerCase();
    const [a, b] = pair;
    const collides = norm(a.roll) === norm(b.roll) || norm(a.leetcode_id) === norm(b.leetcode_id);
    if (!collides) {
      throw new Error(
        `${a.roll} and ${b.roll} no longer share a roll number or a LeetCode ID — refresh the page. Merging is only for genuine duplicates.`,
      );
    }

    const { data: rows, error } = await supabaseAdmin.rpc("merge_students", {
      p_survivor: data.survivorId,
      p_loser: data.loserId,
    });
    if (error) throw new Error(error.message);

    const result = Array.isArray(rows) ? rows[0] : rows;
    return {
      membershipsMoved: result?.memberships_moved ?? 0,
      snapshotsMoved: result?.snapshots_moved ?? 0,
    };
  });

/**
 * Requeue failing students.
 *
 * Resetting `consecutive_failures` first is load-bearing, not tidiness: the
 * worker filters out anyone at or above FAILURE_CUTOFF, so a plain re-enqueue
 * would skip exactly the students this action exists to retry.
 */
export const retryFailedStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: unknown) =>
    z
      .object({
        /** Omit to retry every currently-failing student. */
        studentIds: z.array(z.string().uuid()).optional(),
        /** Displace a refresh that is already running. */
        force: z.boolean().optional().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { authContext } = await import("@/lib/authz");
    const { userId } = authContext(context);

    let ids = data.studentIds ?? [];
    if (ids.length === 0) {
      const { data: failing, error } = await supabaseAdmin
        .from("students")
        .select("id")
        .or("consecutive_failures.gt.0,scrape_error.not.is.null")
        .limit(500);
      if (error) throw new Error(error.message);
      ids = (failing ?? []).map((s) => s.id);
    }

    if (ids.length === 0) return { jobId: null, queued: 0 };

    const { error: resetError } = await supabaseAdmin
      .from("students")
      .update({ consecutive_failures: 0, scrape_error: null })
      .in("id", ids);
    if (resetError) throw new Error(resetError.message);

    const { enqueueRefreshFanOut } = await import("./refresh-enqueue.server");
    const { queued: jobs, skipped } = await enqueueRefreshFanOut({
      scope: "students",
      studentIds: ids,
      filter: "all",
      createdBy: userId,
      force: data.force,
    });

    if (jobs.length === 0) {
      if (skipped.some((s) => s.reason === "already running")) {
        throw new Error("A refresh is already running. Wait for it to finish, or force it.");
      }
      throw new Error(
        skipped.length > 0
          ? skipped.map((s) => `${s.platformId} — ${s.reason}`).join("; ")
          : "No platform is enabled for refresh.",
      );
    }

    return { jobIds: jobs.map((j) => j.jobId), queued: ids.length };
  });
