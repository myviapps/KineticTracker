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
  classroom_id: string | null;
  classroom_name: string | null;
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
      .select(
        "id, name, roll, leetcode_id, classroom_id, scrape_error, consecutive_failures, last_scraped_at, classrooms(name)",
      )
      .or("consecutive_failures.gt.0,scrape_error.not.is.null")
      .order("consecutive_failures", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    return (data ?? []).map((s) => {
      const classroom = s.classrooms as { name: string } | null;
      return {
        id: s.id,
        name: s.name,
        roll: s.roll,
        leetcode_id: s.leetcode_id,
        classroom_id: s.classroom_id,
        classroom_name: classroom?.name ?? null,
        scrape_error: s.scrape_error,
        consecutive_failures: s.consecutive_failures,
        last_scraped_at: s.last_scraped_at,
        abandoned: s.consecutive_failures >= FAILURE_CUTOFF,
      };
    });
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

    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: "students",
      p_student_ids: ids,
      p_filter: "all",
      p_created_by: userId,
      p_force: data.force,
    });

    if (error) {
      if (error.message?.includes("refresh_already_active")) {
        throw new Error("A refresh is already running. Wait for it to finish, or force it.");
      }
      throw new Error(error.message);
    }

    return { jobId, queued: ids.length };
  });
