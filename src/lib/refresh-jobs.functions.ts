import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth, requireAdmin } from "@/integrations/supabase/auth-middleware";

export const enqueueRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "classroom", "students"]),
      classroomId: z.string().uuid().optional(),
      studentIds: z.array(z.string().uuid()).optional(),
      filter: z.enum(["all", "stale", "failed"]).optional().default("all"),
      staleBefore: z.string().optional(),
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

    if (data.scope === "platform" && !isAdmin) throw new Error("Forbidden: admin required for platform refresh");

    if (data.scope === "classroom" && data.classroomId && isFaculty) {
      const { data: assignment } = await supabaseAdmin
        .from("faculty_assignments")
        .select("classroom_id")
        .eq("faculty_user_id", context.userId)
        .eq("classroom_id", data.classroomId)
        .maybeSingle();
      if (!assignment) throw new Error("Forbidden: not assigned to this classroom");
    }

    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
      p_scope: data.scope,
      p_classroom_id: data.classroomId ?? undefined,
      p_student_ids: data.studentIds ?? undefined,
      p_filter: data.filter,
      p_created_by: context.userId,
      p_stale_before: data.staleBefore ?? undefined,
    });

    if (error) throw new Error(error.message);
    return { jobId };
  });

export const getActiveRefreshJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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

export const runRefreshJobChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { runChunk } = await import("./refresh-worker.server");
    return runChunk({ jobId: data.jobId, budgetMs: 50_000 });
  });

export const cancelRefreshJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireAdmin])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("refresh_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString(), lease_owner: null, lease_until: null })
      .eq("id", data.jobId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
