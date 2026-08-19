import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";

/** Matches the ceiling used by the other cohort-wide server functions. */
const MAX_ROWS = 50_000;

/**
 * Newest-first job window for the health page. Only the most recent job per
 * platform is rendered, and there are ~10 platforms, so a few hundred rows is
 * far more than enough to find each one.
 */
const RECENT_JOBS = 500;

export type PlatformHealth = {
  id: string;
  name: string;
  tier: string;
  enabled: boolean;
  has_adapter: boolean;
  sort_order: number;
  notes: string | null;
  // tuning
  batch_size: number;
  base_cooldown_ms: number;
  refresh_ttl_hours: number;
  max_concurrency: number;
  // coverage
  accounts: number;
  active: number;
  invalid: number;
  blocked: number;
  unverified: number;
  fresh: number;
  partial: number;
  failed: number;
  // liveness
  last_fetched_at: string | null;
  job_status: string | null;
  job_progress: string | null;
  resume_after: string | null;
  last_error: string | null;
  sample_error: string | null;
};

/**
 * One row per platform: coverage, freshness and whether it is currently parked.
 *
 * Admin-only, because it exposes tuning knobs and raw adapter errors — those
 * quote handles and upstream messages.
 *
 * Deliberately several small queries rather than one clever join: the counts are
 * over different tables with different filters, and a single query that produced
 * them all would be considerably harder to read than it is slow. There are ten
 * platforms.
 */
export const listPlatformHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { implementedPlatformIds } = await import("@/lib/platforms/registry");
    const withAdapter = new Set(implementedPlatformIds());

    const [{ data: platforms }, { data: accounts }, { data: stats }, { data: jobs }] =
      await Promise.all([
        supabaseAdmin.from("platforms").select("*").order("sort_order"),
        // These two are whole-table scans that grow as students × platforms, and
        // everything below only aggregates them into per-platform counters. Left
        // open-ended they would eventually be cut off by PostgREST's db-max-rows,
        // which is silent — the health page would under-report failures and look
        // healthier than it is. Ranged so the ceiling is ours and explicit.
        supabaseAdmin
          .from("student_platform_accounts")
          .select("platform_id, status, last_fetched_at, fetch_error")
          .range(0, MAX_ROWS - 1),
        supabaseAdmin
          .from("platform_stats")
          .select("platform_id, fetch_status, error_msg")
          .range(0, MAX_ROWS - 1),
        // Only the newest job per platform is used, so a bounded window is
        // sufficient as well as safer.
        supabaseAdmin
          .from("refresh_jobs")
          .select("platform_id, status, processed, total, resume_after, last_error, created_at")
          .not("platform_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_JOBS),
      ]);

    // Newest job per platform; the list above is already newest-first.
    type JobRow = NonNullable<typeof jobs>[number];
    const latestJob = new Map<string, JobRow>();
    for (const j of jobs ?? []) {
      if (j.platform_id && !latestJob.has(j.platform_id)) latestJob.set(j.platform_id, j);
    }

    const ttlByPlatform = new Map(
      (platforms ?? []).map((p) => [p.id, (p.refresh_ttl_hours ?? 24) * 3_600_000]),
    );

    const acc = new Map<string, PlatformHealth>();
    for (const p of platforms ?? []) {
      acc.set(p.id, {
        id: p.id,
        name: p.name,
        tier: p.tier,
        enabled: p.enabled,
        has_adapter: withAdapter.has(p.id),
        sort_order: p.sort_order ?? 100,
        notes: p.notes ?? null,
        batch_size: p.batch_size ?? 5,
        base_cooldown_ms: p.base_cooldown_ms ?? 3000,
        refresh_ttl_hours: p.refresh_ttl_hours ?? 24,
        max_concurrency: p.max_concurrency ?? 3,
        accounts: 0,
        active: 0,
        invalid: 0,
        blocked: 0,
        unverified: 0,
        fresh: 0,
        partial: 0,
        failed: 0,
        last_fetched_at: null,
        job_status: null,
        job_progress: null,
        resume_after: null,
        last_error: null,
        sample_error: null,
      });
    }

    const now = Date.now();
    for (const a of accounts ?? []) {
      const row = acc.get(a.platform_id);
      if (!row) continue;
      row.accounts++;
      if (a.status === "active") row.active++;
      else if (a.status === "invalid_handle") row.invalid++;
      else if (a.status === "blocked") row.blocked++;
      else row.unverified++;

      if (a.last_fetched_at) {
        const t = Date.parse(a.last_fetched_at);
        if (now - t < (ttlByPlatform.get(a.platform_id) ?? 86_400_000)) row.fresh++;
        if (!row.last_fetched_at || t > Date.parse(row.last_fetched_at)) {
          row.last_fetched_at = a.last_fetched_at;
        }
      }
      // First real error is enough to diagnose; the rest are usually identical.
      if (a.fetch_error && !row.sample_error) row.sample_error = a.fetch_error.slice(0, 200);
    }

    for (const s of stats ?? []) {
      const row = acc.get(s.platform_id);
      if (!row) continue;
      if (s.fetch_status === "partial") row.partial++;
      if (s.fetch_status === "failed") row.failed++;
      if (s.error_msg && !row.sample_error) row.sample_error = s.error_msg.slice(0, 200);
    }

    for (const [platformId, job] of latestJob) {
      const row = acc.get(platformId);
      if (!row) continue;
      row.job_status = job.status;
      row.job_progress = `${job.processed ?? 0}/${job.total ?? 0}`;
      row.resume_after = job.resume_after;
      row.last_error = job.last_error;
    }

    return { platforms: [...acc.values()] };
  });

/** Flip a platform on or off without a deploy. */
export const setPlatformEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { id: string; enabled: boolean }) =>
    z.object({ id: z.string().min(1).max(50), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("platforms")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Clear a circuit-breaker pause.
 *
 * Cancels the parked job rather than un-pausing it: `resume_after` is the
 * breaker's own timer, and clearing it in place would leave a job holding the
 * platform's single-flight lock with no record of why it stopped.
 */
export const resetPlatformBreaker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { id: string }) => z.object({ id: z.string().min(1).max(50) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("refresh_jobs")
      .update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        lease_owner: null,
        lease_until: null,
        resume_after: null,
      })
      .eq("platform_id", data.id)
      .in("status", ["paused", "running", "queued"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Queue a full refresh for one platform. */
export const refreshPlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator((d: { id: string }) => z.object({ id: z.string().min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_platform_refresh_job", {
      p_platform_id: data.id,
      p_scope: "platform",
      p_created_by: context.userId,
      // Replace whatever is queued for THIS platform. Per-platform locking means
      // that cannot disturb any other platform's run.
      p_force: true,
    });
    if (error) throw new Error(error.message);
    return { jobId };
  });

/** Update batch size, max concurrency, cooldown and refresh TTL for a platform. */
export const updatePlatformTuning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  .validator(
    (d: {
      id: string;
      batch_size: number;
      max_concurrency: number;
      base_cooldown_ms: number;
      refresh_ttl_hours: number;
    }) =>
      z
        .object({
          id: z.string().min(1).max(50),
          batch_size: z.number().int().min(1).max(100),
          max_concurrency: z.number().int().min(1).max(20),
          base_cooldown_ms: z.number().int().min(0).max(60_000),
          refresh_ttl_hours: z.number().int().min(1).max(720),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("platforms")
      .update({
        batch_size: data.batch_size,
        max_concurrency: data.max_concurrency,
        base_cooldown_ms: data.base_cooldown_ms,
        refresh_ttl_hours: data.refresh_ttl_hours,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
