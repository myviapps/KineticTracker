import type { Database } from "@/integrations/supabase/types";
import { log } from "./log.server";

const TAIL_MS = 6_000;

export type ChunkResult = {
  /** false when another worker already holds the lease */
  claimed: boolean;
  /** true when the queue is drained and the job is complete */
  done: boolean;
  paused?: boolean;
  aborted?: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  total: number;
  /**
   * The job's status as the server sees it. Authoritative — the client's polled
   * copy goes stale whenever the tab is backgrounded (TanStack Query pauses
   * `refetchInterval` when the window loses focus), so the pump must decide
   * whether to keep going from this, not from its cache.
   */
  jobStatus?: string;
};

export async function runChunk({
  jobId,
  budgetMs = 50_000,
  ownerId,
}: {
  jobId: string;
  budgetMs?: number;
  ownerId?: string;
}): Promise<ChunkResult> {
  const owner = ownerId ?? crypto.randomUUID();
  const empty = { processed: 0, succeeded: 0, failed: 0, total: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  log.info(
    "chunk",
    `▶ start job=${jobId.slice(0, 8)} owner=${owner.slice(0, 8)} budget=${budgetMs}ms`,
  );

  // Lease just long enough to cover this chunk. It is set and compared entirely
  // by the Postgres clock, so it is immune to app/DB clock skew — which is real:
  // a dev machine running ~33s ahead of Supabase made every app-written
  // lease_until land in the database's future.
  const leaseSeconds = Math.ceil(budgetMs / 1000) + 10;

  const { data: claimResult, error: claimError } = await supabaseAdmin.rpc("claim_refresh_job", {
    p_job_id: jobId,
    p_lease_seconds: leaseSeconds,
    p_owner: owner,
  });
  if (claimError) {
    log.error("chunk", "claim_refresh_job RPC failed", claimError);
    throw claimError;
  }
  if (!claimResult) {
    // Report why, so the pump can stop instead of retrying a finished job.
    const { data: row } = await supabaseAdmin
      .from("refresh_jobs")
      .select("status, processed, succeeded, failed, total")
      .eq("id", jobId)
      .maybeSingle();
    const jobStatus = row?.status ?? "missing";
    log.info("chunk", `✋ not claimed — job status=${jobStatus}`);
    return {
      claimed: false,
      done: jobStatus === "completed",
      jobStatus,
      processed: row?.processed ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      total: row?.total ?? 0,
    };
  }

  const job = claimResult as Database["public"]["Tables"]["refresh_jobs"]["Row"];
  let cursor: string | null = job.cursor_student_id ?? null;
  const batchSize = job.batch_size ?? 5;
  let cooldownMs = job.cooldown_ms ?? 3000;
  let cleanStreak = job.clean_streak ?? 0;
  let succeeded = job.succeeded ?? 0;
  let failed = job.failed ?? 0;
  let processed = job.processed ?? 0;
  const total = job.total ?? 0;
  const baseCooldown = 3000;

  const t0 = Date.now();
  let done = false;
  let consecutiveThrottleBatches = 0;
  let batchNo = 0;

  log.ok("chunk", "✔ claimed", {
    scope: job.scope,
    classroom: job.classroom_id?.slice(0, 8) ?? "-",
    cursor: cursor?.slice(0, 8) ?? "START",
    progress: `${processed}/${total}`,
    batchSize,
    cooldownMs,
  });

  while (Date.now() - t0 + estimateBatchMs(batchSize, cooldownMs) < budgetMs - TAIL_MS) {
    batchNo += 1;
    const bStart = Date.now();
    let query = supabaseAdmin
      .from("students")
      .select("id, consecutive_failures")
      .gt("id", cursor ?? "00000000-0000-0000-0000-000000000000")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (job.scope === "classroom" && job.classroom_id) {
      query = query.eq("classroom_id", job.classroom_id);
    } else if (job.scope === "students" && job.student_ids?.length) {
      query = query.in("id", job.student_ids);
    }
    query = query.filter("consecutive_failures", "lt", 5);

    // This error was previously discarded, so a failing query looked identical
    // to "queue drained" and silently completed the job.
    const { data: students, error: studentsError } = await query;
    if (studentsError) {
      log.error("chunk", `batch ${batchNo}: student query failed`, studentsError);
      throw studentsError;
    }
    if (!students || students.length === 0) {
      log.ok("chunk", `queue drained after ${batchNo - 1} batches`);
      done = true;
      break;
    }

    log.info("chunk", `batch ${batchNo}: fetching ${students.length} students concurrently…`);
    const scrapeResults = await Promise.allSettled(students.map((s) => scrapeOne(s.id)));
    log.info("chunk", `batch ${batchNo}: fetch done ${Date.now() - bStart}ms`);

    let batchOk = 0;
    let batchThrottled = 0;
    const batchErrors: { student_id: string; error: string; kind: string }[] = [];

    for (let i = 0; i < scrapeResults.length; i++) {
      const r = scrapeResults[i];
      if (r.status === "fulfilled") {
        batchOk++;
      } else {
        const err = r.reason;
        const isThrottle =
          err?.kind === "throttle" || (err?.name === "LeetCodeError" && err?.kind === "throttle");
        if (isThrottle) {
          batchThrottled++;
        }
        batchErrors.push({
          student_id: students[i].id,
          error: err?.message ?? String(err),
          kind: isThrottle ? "throttle" : "fail",
        });
        log.warn("chunk", `  ✕ student ${students[i].id.slice(0, 8)}`, {
          kind: isThrottle ? "throttle" : "fail",
          err: String(err?.message ?? err).slice(0, 160),
        });
      }
    }
    const batchFailed = scrapeResults.length - batchOk;
    const lastStudent = students[students.length - 1];

    if (batchThrottled > 0) {
      cooldownMs = Math.min(cooldownMs * 2, 60_000);
      cleanStreak = 0;
      consecutiveThrottleBatches++;
    } else {
      cleanStreak++;
      consecutiveThrottleBatches = 0;
      if (cleanStreak >= 3) {
        cooldownMs = Math.max(Math.round(cooldownMs * 0.75), baseCooldown);
        cleanStreak = 0;
      }
    }

    const throttleRatio = batchThrottled / batchSize;
    const tripCircuit = consecutiveThrottleBatches >= 2 && throttleRatio >= 0.6;

    if (tripCircuit) {
      await supabaseAdmin
        .from("refresh_jobs")
        .update({
          status: "paused",
          resume_after: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: "Rate limited — circuit breaker engaged",
          cooldown_ms: cooldownMs,
          clean_streak: 0,
          lease_owner: null,
          lease_until: null,
        })
        .eq("id", jobId)
        .eq("lease_owner", owner);
      return { claimed: true, done: false, paused: true, processed, succeeded, failed, total };
    }

    const { data: committed, error: commitError } = await supabaseAdmin.rpc(
      "commit_refresh_batch",
      {
        p_job_id: jobId,
        p_owner: owner,
        p_expected_cursor: cursor,
        p_new_cursor: lastStudent.id,
        p_ok: batchOk,
        p_failed: batchFailed,
        p_cooldown_ms: cooldownMs,
        p_clean_streak: cleanStreak,
        // Pass the ARRAY, not JSON.stringify(...). A stringified array arrives as
        // a jsonb string scalar, and commit_refresh_batch calls
        // jsonb_array_length() on it → SQLSTATE 22023 "cannot get array length of
        // a scalar". The commit then threw, the chunk aborted, and the job stalled
        // permanently on the first batch that contained ANY failing student.
        p_errors: batchErrors.length > 0 ? batchErrors : null,
        p_done: false,
      },
    );

    if (commitError) {
      log.error("chunk", `batch ${batchNo}: commit_refresh_batch RPC failed`, commitError);
      throw commitError;
    }
    if (!committed) {
      // 0 rows matched: another worker advanced the cursor, or our lease was
      // stolen. Bail rather than double-count.
      log.warn("chunk", `batch ${batchNo}: commit rejected — lease or cursor moved under us`, {
        expectedCursor: cursor?.slice(0, 8) ?? "null",
        owner: owner.slice(0, 8),
      });
      return { claimed: true, done: false, aborted: true, processed, succeeded, failed, total };
    }

    cursor = lastStudent.id;
    processed += batchOk + batchFailed;
    succeeded += batchOk;
    failed += batchFailed;

    log.ok(
      "chunk",
      `batch ${batchNo}: committed ✓${batchOk} ✕${batchFailed} — ${processed}/${total} in ${Date.now() - bStart}ms`,
      {
        cooldownMs,
        elapsed: `${Math.round((Date.now() - t0) / 1000)}s/${Math.round(budgetMs / 1000)}s`,
      },
    );

    if (Date.now() - t0 + cooldownMs < budgetMs - TAIL_MS) {
      await sleep(cooldownMs);
    }
  }

  if (done) {
    await supabaseAdmin
      .from("refresh_jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        lease_owner: null,
        lease_until: null,
      })
      .eq("id", jobId)
      .eq("lease_owner", owner);

    const { data: jobRow } = await supabaseAdmin
      .from("refresh_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobRow) {
      await supabaseAdmin.from("scrape_runs").insert({
        source:
          jobRow.scope === "platform"
            ? "cron"
            : jobRow.scope === "classroom"
              ? "classroom"
              : "student",
        classroom_id: jobRow.classroom_id,
        started_at: jobRow.started_at ?? new Date().toISOString(),
        completed_at: new Date().toISOString(),
        total_students: jobRow.total,
        success_count: jobRow.succeeded,
        failed_count: jobRow.failed,
        errors: jobRow.errors,
      });
    }
  } else {
    // Hand the job back for the next chunk.
    //
    // This MUST use the database clock. Writing lease_until from here (either a
    // back-dated timestamp or NULL) is what stalled jobs: an app timestamp is
    // subject to clock skew, and NULL never satisfies `lease_until < now()`
    // because `NULL < now()` is NULL, not TRUE.
    //
    // release_refresh_job does it server-side in one statement. Until that
    // migration is applied the call 404s, which is harmless — the lease simply
    // expires on its own a few seconds later and the next pump picks it up.
    // Not in the generated types until the migration is applied and
    // `npm run gen-types` is re-run, hence the cast. Cast the CLIENT, not the
    // method — pulling `.rpc` off the object loses its `this` and supabase-js
    // then dies on `this.rest`.
    const client = supabaseAdmin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
    const { error: releaseError } = await client.rpc("release_refresh_job", {
      p_job_id: jobId,
      p_owner: owner,
    });
    if (releaseError) {
      log.warn(
        "chunk",
        `release_refresh_job unavailable (${releaseError.code ?? "?"}) — lease will expire naturally in <${leaseSeconds}s`,
      );
    } else {
      log.info("chunk", "lease released — job is claimable again");
    }
  }

  log.ok(
    "chunk",
    `■ end — done=${done} ${processed}/${total} after ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  return { claimed: true, done, processed, succeeded, failed, total };
}

async function scrapeOne(studentId: string): Promise<void> {
  const { scrapeStudentById } = await import("./scrape.server");
  await scrapeStudentById(studentId);
}

function estimateBatchMs(_batchSize: number, cooldownMs: number): number {
  return 12_000 + cooldownMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
