import { implementedPlatformIds } from "./platforms/registry";

/**
 * The one place a refresh is queued.
 *
 * Every caller used to hit `enqueue_refresh_job` directly, which takes no
 * platform and therefore produced a job with `platform_id = NULL`. The pump
 * routes NULL to the legacy LeetCode worker, so "Refresh all" has only ever
 * refreshed LeetCode — the four other adapters were unreachable in production.
 *
 * This fans out instead: one job per enabled platform that actually has an
 * adapter. `enqueue_platform_refresh_job` scopes the single-flight lock to
 * `platform:<id>`, so the jobs coexist, and `next_platform_job()` orders by
 * `coalesce(started_at, created_at)` so the pump round-robins rather than
 * letting one busy platform starve the rest.
 */

export type EnqueueScope = "platform" | "classroom" | "students";

export type FanOutResult = {
  /** Jobs actually created, in platform order. */
  queued: { platformId: string; jobId: string }[];
  /**
   * Platforms deliberately not queued, with the reason. A platform already
   * running is the common case and is NOT an error — see the loop below.
   */
  skipped: { platformId: string; reason: string }[];
};

export type FanOutOptions = {
  scope: EnqueueScope;
  classroomId?: string | null;
  studentIds?: string[] | null;
  filter?: string;
  createdBy?: string | null;
  staleBefore?: string | null;
  force?: boolean;
  /** Restrict the fan-out to these platforms. Omit for "every enabled one". */
  platformIds?: string[] | null;
};

/**
 * Which platforms a refresh should actually touch.
 *
 * Both conditions matter and neither implies the other: `platforms.enabled` is
 * the operator's switch, and the registry is what code exists for. Rows exist
 * for hackerearth, spoj, interviewbit, code360 and kaggle so they can be
 * configured and weighted ahead of implementation — queueing those would create
 * jobs that `runPlatformChunk` can only fail with "No adapter for <id>".
 */
export async function refreshablePlatformIds(restrictTo?: string[] | null): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("platforms")
    .select("id, sort_order")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  const implemented = new Set(implementedPlatformIds());
  const wanted = restrictTo?.length ? new Set(restrictTo) : null;

  return (data ?? [])
    .map((p) => p.id)
    .filter((id) => implemented.has(id))
    .filter((id) => !wanted || wanted.has(id));
}

export async function enqueueRefreshFanOut(opts: FanOutOptions): Promise<FanOutResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { log } = await import("./log.server");

  const platformIds = await refreshablePlatformIds(opts.platformIds);

  const queued: FanOutResult["queued"] = [];
  const skipped: FanOutResult["skipped"] = [];

  for (const platformId of platformIds) {
    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_platform_refresh_job", {
      p_platform_id: platformId,
      p_scope: opts.scope,
      p_classroom_id: opts.classroomId ?? undefined,
      p_student_ids: opts.studentIds ?? undefined,
      p_filter: opts.filter ?? "all",
      p_created_by: opts.createdBy ?? undefined,
      p_stale_before: opts.staleBefore ?? undefined,
      p_force: opts.force ?? false,
    });

    if (error) {
      /*
        Caught per platform, never for the batch. Codeforces already running is
        not a reason to skip LeetCode — that would reintroduce the global
        single-flight behaviour the per-platform lock_key exists to remove.
      */
      if (error.message?.includes("refresh_already_active")) {
        skipped.push({ platformId, reason: "already running" });
        continue;
      }
      if (error.message?.includes("unknown_platform")) {
        skipped.push({ platformId, reason: "unknown platform" });
        continue;
      }
      log.error("enqueue", `could not queue ${platformId}`, error);
      skipped.push({ platformId, reason: error.message ?? "enqueue failed" });
      continue;
    }

    if (jobId) queued.push({ platformId, jobId: jobId as string });
  }

  log.info("enqueue", `fan-out ${opts.scope}`, {
    queued: queued.map((q) => q.platformId),
    skipped: skipped.map((s) => `${s.platformId}(${s.reason})`),
  });

  return { queued, skipped };
}
