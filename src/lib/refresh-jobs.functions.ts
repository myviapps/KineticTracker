import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authContext,
  withRole,
  requireRole,
  canAdminister,
  canManageStudents,
  assertClassroomAccess,
} from "@/lib/authz";

/**
 * The single entry point for starting a refresh. `refreshClassroom` and
 * `refreshPlatform` in students.functions.ts used to be a second, more permissive
 * path into the same RPC — they are gone.
 */
export const enqueueRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: unknown) =>
    z
      .object({
        scope: z.enum(["platform", "classroom", "students"]),
        classroomId: z.string().uuid().optional(),
        studentIds: z.array(z.string().uuid()).optional(),
        filter: z.enum(["all", "stale", "failed"]).optional().default("all"),
        staleBefore: z.string().optional(),
        /** Admin-only: take over a refresh that is already running. */
        force: z.boolean().optional().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    if (!canManageStudents(role)) throw new Error("Forbidden");

    if (data.scope === "platform" && !canAdminister(role))
      throw new Error("Forbidden: admin required for platform refresh");

    if (data.scope === "classroom") {
      if (!data.classroomId) throw new Error("classroomId is required for a classroom refresh");
      await assertClassroomAccess(userId, role, data.classroomId);
    }

    if (data.scope === "students") {
      const ids = data.studentIds ?? [];
      if (ids.length === 0) throw new Error("studentIds is required for a student refresh");
      // Confirm access to every classroom the batch touches, not just the first.
      const { data: rows } = await supabaseAdmin
        .from("students")
        .select("classroom_id")
        .in("id", ids);
      for (const cid of new Set((rows ?? []).map((r) => r.classroom_id))) {
        await assertClassroomAccess(userId, role, cid);
      }
    }

    // enqueue_refresh_job used to unconditionally cancel whatever was queued or
    // running before inserting, so any faculty member starting a classroom refresh
    // silently killed an admin's in-flight platform run — the only thing stopping
    // it was a `disabled` prop in the browser. The RPC now refuses to displace an
    // active job unless the caller passes p_force, which only an admin can do.
    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: data.scope,
      p_classroom_id: data.classroomId ?? undefined,
      p_student_ids: data.studentIds ?? undefined,
      p_filter: data.filter,
      p_created_by: userId,
      p_stale_before: data.staleBefore ?? undefined,
      p_force: data.force && canAdminister(role),
    });

    if (error) {
      if (error.message?.includes("refresh_already_active")) {
        throw new Error(
          "A refresh is already running. Wait for it to finish, or cancel it from Staff Management.",
        );
      }
      throw new Error(error.message);
    }
    return { jobId };
  });

export const getActiveRefreshJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("refresh_jobs")
      .select("*")
      .in("status", ["queued", "running", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data ?? null;
  });

/**
 * Drives one chunk of a job forward. Every signed-in tab calls this (see
 * useRefreshJobPump), so it is intentionally open to any role — but it now
 * verifies the job is actually live first, instead of handing an arbitrary uuid
 * straight to the worker.
 */
export const runRefreshJobChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job } = await supabaseAdmin
      .from("refresh_jobs")
      .select("status, processed, succeeded, failed, total")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (!["queued", "running", "paused"].includes(job.status)) {
      // Already finished/cancelled — tell the pump to stop rather than letting it
      // claim-and-retry a dead job.
      return {
        claimed: false,
        done: job.status === "completed",
        jobStatus: job.status,
        processed: job.processed,
        succeeded: job.succeeded,
        failed: job.failed,
        total: job.total,
      };
    }

    const { runChunk } = await import("./refresh-worker.server");
    const { log } = await import("./log.server");
    try {
      return await runChunk({ jobId: data.jobId, budgetMs: 50_000 });
    } catch (e) {
      // Previously this rejected straight through the server-fn boundary, so the
      // browser saw a bare 500 and the terminal saw nothing. The job then sat on
      // its 60s lease until it expired and the whole cycle repeated.
      log.error("chunk", "runChunk threw — releasing lease so the next pump can retry", e);
      try {
        await supabaseAdmin
          .from("refresh_jobs")
          .update({
            lease_owner: null,
            // Back-dated, not null — see the note in refresh-worker.server.ts.
            lease_until: new Date(Date.now() - 1000).toISOString(),
            last_error: String((e as Error)?.message ?? e).slice(0, 300),
          })
          .eq("id", data.jobId);
      } catch (releaseErr) {
        log.error("chunk", "could not release lease after failure", releaseErr);
      }
      throw e;
    }
  });

export const cancelRefreshJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("refresh_jobs")
      .update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        lease_owner: null,
        lease_until: null,
      })
      .eq("id", data.jobId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
