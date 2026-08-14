// Server-only: run as many queued refresh chunks as fit in one invocation.
//
// ── Why this exists ────────────────────────────────────────────────────────
// Both entry points used to run exactly ONE chunk and return:
//
//   /api/public/jobs/pump      — GitHub Actions, every 10 minutes
//   /api/public/cron/refresh   — Vercel Cron, once daily
//
// One chunk per invocation is fine when the pump is healthy and firing every
// 10 minutes. It is not fine when the pump is misconfigured — a wrong or
// missing CRON_SECRET in GitHub silently reduces the whole pipeline to the
// daily Vercel cron, and one chunk a day never drains a queue. Worse, a chunk
// that finished early (small platform, or the job completed) handed back the
// rest of its 50s budget unused while other platforms sat queued.
//
// Draining inside the budget makes each invocation worth as much as the
// platform allows, so the system still makes real daily progress even with the
// 10-minute pump completely dead. It does not extend the invocation — the wall
// budget is the same — it just stops leaving time on the table.

import type { ChunkResult } from "./refresh-worker.server";

export type DrainRun = ChunkResult & { jobId: string; platformId: string | null };

export type DrainResult = {
  runs: DrainRun[];
  /** Why the loop stopped — surfaced in the response so a dead pump is legible. */
  stopped: "budget" | "no eligible job" | "no progress" | "paused" | "max jobs" | "error";
  error?: string;
};

/**
 * Starting a chunk needs enough runway to claim a lease, fetch at least one
 * account and commit the cursor. Below this the chunk would be killed
 * mid-flight and the invocation would be spent for nothing.
 */
const MIN_CHUNK_MS = 8_000;

/** Backstop against a pathological loop that neither progresses nor completes. */
const MAX_JOBS = 25;

export async function drainJobs({ budgetMs }: { budgetMs: number }): Promise<DrainResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const startedAt = Date.now();
  const remaining = () => budgetMs - (Date.now() - startedAt);

  const runs: DrainRun[] = [];

  while (runs.length < MAX_JOBS) {
    if (remaining() < MIN_CHUNK_MS) return { runs, stopped: "budget" };

    // Eligibility lives in next_platform_job(), in SQL — see the note in
    // pump.ts. It round-robins on coalesce(started_at, created_at), so a busy
    // platform cannot starve the others across iterations of this loop.
    const { data: jobId, error: pickError } = await supabaseAdmin.rpc("next_platform_job");
    if (pickError) return { runs, stopped: "error", error: pickError.message };
    if (!jobId) return { runs, stopped: "no eligible job" };

    const { data: job, error: jobError } = await supabaseAdmin
      .from("refresh_jobs")
      .select("id, platform_id")
      .eq("id", jobId as string)
      .maybeSingle();
    if (jobError) return { runs, stopped: "error", error: jobError.message };
    if (!job) return { runs, stopped: "no eligible job" };

    // platform_id decides which worker owns this job. Legacy jobs (null) keep
    // running through the student-based worker, so a job queued before the
    // per-platform split finishes on the code that created it rather than
    // being handed a cursor it does not understand.
    let result: ChunkResult;
    if (job.platform_id) {
      const { runPlatformChunk } = await import("./platform-worker.server");
      result = await runPlatformChunk({ jobId: job.id, budgetMs: remaining() });
    } else {
      const { runChunk } = await import("./refresh-worker.server");
      result = await runChunk({ jobId: job.id, budgetMs: remaining() });
    }

    runs.push({ ...result, jobId: job.id, platformId: job.platform_id });

    // Another worker holds the lease — next_platform_job only hints, and
    // claim_refresh_job is the authority. Yield rather than spin against it.
    if (!result.claimed) return { runs, stopped: "no progress" };
    if (result.paused || result.aborted) return { runs, stopped: "paused" };

    /*
      A chunk that neither completed the job nor processed anything would be
      picked again on the next iteration with the same outcome. Stop instead of
      burning the rest of the budget on a job that is not moving — a completed
      job is fine to follow with the next one, which is the whole point here.
    */
    if (!result.done && result.processed === 0) return { runs, stopped: "no progress" };
  }

  return { runs, stopped: "max jobs" };
}
