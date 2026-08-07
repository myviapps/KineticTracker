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
} from "@/lib/authz";

/**
 * The single entry point for starting a refresh. `refreshClassroom` and
 * `refreshPlatform` in students.functions.ts used to be a second, more permissive
 * path into the same RPC — they are gone.
 */
export const enqueueRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) =>
    z
      .object({
        scope: z.enum(["platform", "classroom", "students"]),
        classroomId: z.string().uuid().optional(),
        studentIds: z.array(z.string().uuid()).optional(),
        filter: z.enum(["all", "stale", "failed"]).optional().default("all"),
        staleBefore: z.string().optional(),
        /** Admin-only: take over a refresh that is already running. */
        force: z.boolean().optional().default(false),
        /** Restrict the fan-out to these platforms. Omit for every enabled one. */
        platformIds: z.array(z.string().min(1).max(50)).optional(),
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

      /*
        Every student in the batch must be reachable. This used to resolve each
        student's single classroom and require access to ALL of them; with
        memberships the rule is ANY-intersection per student, resolved in one
        query against the caller's assignments rather than N round trips.
      */
      const allowed = await accessibleClassroomIds(userId, role);
      if (allowed !== null) {
        if (allowed.length === 0) throw new Error("Forbidden");
        const { data: rows } = await supabaseAdmin
          .from("classroom_students")
          .select("student_id")
          .in("student_id", ids)
          .in("classroom_id", allowed);
        const reachable = new Set((rows ?? []).map((r) => r.student_id));
        if (ids.some((id) => !reachable.has(id))) {
          throw new Error("Forbidden: the batch includes students outside your classrooms");
        }
      }
    }

    /*
      One job per enabled platform, not one job overall. The RPC refuses to
      displace a job that is already active for the SAME platform unless the
      caller passes p_force, which only an admin can do — the guard that stopped
      a faculty classroom refresh from silently killing an admin's platform run.
      Per-platform locking means that guard no longer serialises everything.
    */
    const { enqueueRefreshFanOut } = await import("./refresh-enqueue.server");
    const { queued, skipped } = await enqueueRefreshFanOut({
      scope: data.scope,
      classroomId: data.classroomId,
      studentIds: data.studentIds,
      filter: data.filter,
      createdBy: userId,
      staleBefore: data.staleBefore,
      force: data.force && canAdminister(role),
      platformIds: data.platformIds,
    });

    // Only an error if NOTHING started. One platform mid-run while the others
    // queue is the normal, healthy case.
    if (queued.length === 0) {
      const busy = skipped.filter((s) => s.reason === "already running");
      if (busy.length > 0) {
        throw new Error(
          "A refresh is already running for every platform. Wait for it to finish, or cancel it from Staff Management.",
        );
      }
      throw new Error(
        skipped.length > 0
          ? `Could not queue a refresh: ${skipped.map((s) => `${s.platformId} — ${s.reason}`).join("; ")}`
          : "No platform is enabled for refresh.",
      );
    }

    return { jobIds: queued.map((q) => q.jobId), queued, skipped };
  });

/**
 * Every non-terminal job, plus the display name of the platform each belongs to.
 *
 * Was `.limit(1).maybeSingle()`, which made sense while a refresh was one global
 * job. Now that the enqueue fans out per platform there can be one job per
 * enabled adapter, and returning only the newest made the other four invisible —
 * the progress UI would show one platform and silently ignore the rest.
 */
export const getActiveRefreshJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("refresh_jobs")
      .select("*")
      .in("status", ["queued", "running", "paused"])
      .order("created_at", { ascending: true });

    const jobs = data ?? [];
    if (jobs.length === 0) return [];

    // Names for the UI. A legacy job (platform_id null) is LeetCode by
    // definition — that is what the old worker refreshes.
    const ids = [...new Set(jobs.map((j) => j.platform_id).filter((v): v is string => !!v))];
    const { data: platforms } = ids.length
      ? await supabaseAdmin.from("platforms").select("id, name, sort_order").in("id", ids)
      : { data: [] as { id: string; name: string; sort_order: number | null }[] };

    const nameById = new Map((platforms ?? []).map((p) => [p.id, p.name]));
    const orderById = new Map((platforms ?? []).map((p) => [p.id, p.sort_order ?? 100]));

    return jobs
      .map((j) => ({
        ...j,
        platform_id: j.platform_id ?? "leetcode",
        platform_name: j.platform_id ? (nameById.get(j.platform_id) ?? j.platform_id) : "LeetCode",
        sort_order: j.platform_id ? (orderById.get(j.platform_id) ?? 100) : 0,
      }))
      .sort((a, b) => a.sort_order - b.sort_order);
  });

/**
 * Which job the pump should advance next. Same rule the cron pump uses, so the
 * browser pump and the cron pump cannot disagree about fairness.
 */
export const getNextRefreshJobId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("next_platform_job");
    return (data as string | null) ?? null;
  });

/**
 * Drives one chunk of a job forward. Every signed-in tab calls this (see
 * useRefreshJobPump), so it is intentionally open to any role — but it now
 * verifies the job is actually live first, instead of handing an arbitrary uuid
 * straight to the worker.
 */
export const runRefreshJobChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job } = await supabaseAdmin
      .from("refresh_jobs")
      .select("status, processed, succeeded, failed, total, platform_id")
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

    /*
      Same dispatch rule as the cron pump (routes/api/public/jobs/pump.ts):
      platform_id decides which worker owns the job. This branch was missing, and
      it is not hypothetical — the admin Platforms page already enqueues jobs via
      enqueue_platform_refresh_job, and every signed-in tab pumps through here.
      A platform job handed to runChunk pages `students` and writes
      cursor_student_id, while runPlatformChunk resumes from cursor_account_id:
      the job would restart from the beginning of the account scan on every chunk
      and never finish.
    */
    const { log } = await import("./log.server");
    const runner = job.platform_id
      ? (await import("./platform-worker.server")).runPlatformChunk
      : (await import("./refresh-worker.server")).runChunk;
    try {
      return await runner({ jobId: data.jobId, budgetMs: 50_000 });
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
  .validator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
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
