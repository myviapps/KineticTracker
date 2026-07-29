import type { Database } from "@/integrations/supabase/types";

const TAIL_MS = 6_000;

export async function runChunk({
  jobId,
  budgetMs = 50_000,
  ownerId,
}: {
  jobId: string;
  budgetMs?: number;
  ownerId?: string;
}) {
  const owner = ownerId ?? crypto.randomUUID();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: claimResult, error: claimError } = await supabaseAdmin.rpc(
    "claim_refresh_job",
    {
      p_job_id: jobId,
      p_lease_seconds: 60,
      p_owner: owner,
    },
  );
  if (claimError) throw claimError;
  if (!claimResult) return { claimed: false };

  const job = claimResult as Database["public"]["Tables"]["refresh_jobs"]["Row"];
  let cursor: string | null = job.cursor_student_id ?? null;
  let batchSize = job.batch_size ?? 5;
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

  while (Date.now() - t0 + estimateBatchMs(batchSize, cooldownMs) < budgetMs - TAIL_MS) {
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

    const { data: students } = await query;
    if (!students || students.length === 0) {
      done = true;
      break;
    }

    const scrapeResults = await Promise.allSettled(
      students.map((s) => scrapeOne(s.id)),
    );

    let batchOk = 0;
    let batchThrottled = 0;
    const batchErrors: object[] = [];

    for (let i = 0; i < scrapeResults.length; i++) {
      const r = scrapeResults[i];
      if (r.status === "fulfilled") {
        batchOk++;
      } else {
        const err = r.reason;
        const isThrottle = err?.kind === "throttle" || err?.name === "LeetCodeError" && err?.kind === "throttle";
        if (isThrottle) {
          batchThrottled++;
        }
        batchErrors.push({
          student_id: students[i].id,
          error: err?.message ?? String(err),
          kind: isThrottle ? "throttle" : "fail",
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
      return { done: false, paused: true, processed, succeeded, failed, total };
    }

    const { data: committed } = await supabaseAdmin.rpc("commit_refresh_batch", {
      p_job_id: jobId,
      p_owner: owner,
      p_expected_cursor: cursor,
      p_new_cursor: lastStudent.id,
      p_ok: batchOk,
      p_failed: batchFailed,
      p_cooldown_ms: cooldownMs,
      p_clean_streak: cleanStreak,
      p_errors: batchErrors.length > 0 ? JSON.stringify(batchErrors) : null,
      p_done: false,
    });

    if (!committed) {
      return { done: false, aborted: true, processed, succeeded, failed, total };
    }

    cursor = lastStudent.id;
    processed += batchOk + batchFailed;
    succeeded += batchOk;
    failed += batchFailed;

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
        source: jobRow.scope === "platform" ? "cron" : jobRow.scope === "classroom" ? "classroom" : "student",
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
    await supabaseAdmin
      .from("refresh_jobs")
      .update({ lease_owner: null, lease_until: null })
      .eq("id", jobId)
      .eq("lease_owner", owner);
  }

  return { done, processed, succeeded, failed, total };
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
