// The multi-platform chunk worker.
//
// A sibling of refresh-worker.server.ts rather than a rewrite of it: that file
// still drives the LeetCode-only path against students/student_stats and stays
// untouched until nothing calls it. Keeping both means a bad deploy is a
// `git revert`, not a data migration.
//
// The mechanics that were learned the hard way are carried over verbatim —
// lease-then-commit with compare-and-swap, adaptive cooldown, the circuit
// breaker, and the measured batch estimator. What changes is the unit of work:
// a (student, platform) ACCOUNT rather than a student. That single change is
// what lets one platform be rate-limited without stalling the rest.

import { log } from "./log.server";
import { getAdapter } from "./platforms/registry";
import { PlatformError, type NormalizedProfile } from "./platforms/types";
import {
  persistPlatformProfile,
  recordFetchFailure,
  ACCOUNT_FAILURE_CUTOFF,
} from "./platform-stats.server";
import type { ChunkResult } from "./refresh-worker.server";

/** Headroom left for the commit, release and logging after the last batch. */
const TAIL_MS = 6_000;

type AccountRow = {
  account_id: string;
  student_id: string;
  handle: string;
  sync_cursor: Record<string, unknown> | null;
};

type PlatformConfig = {
  id: string;
  batch_size: number;
  base_cooldown_ms: number;
  est_batch_ms: number;
  max_concurrency: number;
  supports_batch_fetch: boolean;
  enabled: boolean;
};

/** Bounded-concurrency map. A batch of 20 must not open 20 sockets to one host. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runPlatformChunk({
  jobId,
  budgetMs = 50_000,
  ownerId,
}: {
  jobId: string;
  budgetMs?: number;
  ownerId?: string;
}): Promise<ChunkResult> {
  const owner = ownerId ?? crypto.randomUUID();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  log.info(
    "platform",
    `▶ start job=${jobId.slice(0, 8)} owner=${owner.slice(0, 8)} budget=${budgetMs}ms`,
  );

  const leaseSeconds = Math.ceil(budgetMs / 1000) + 10;
  const { data: claimResult, error: claimError } = await supabaseAdmin.rpc("claim_refresh_job", {
    p_job_id: jobId,
    p_lease_seconds: leaseSeconds,
    p_owner: owner,
  });
  if (claimError) {
    log.error("platform", "claim_refresh_job failed", claimError);
    throw claimError;
  }
  if (!claimResult) {
    const { data: row } = await supabaseAdmin
      .from("refresh_jobs")
      .select("status, processed, succeeded, failed, total")
      .eq("id", jobId)
      .maybeSingle();
    const jobStatus = row?.status ?? "missing";
    log.info("platform", `✋ not claimed — status=${jobStatus}`);
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

  const job = claimResult as unknown as {
    id: string;
    platform_id: string | null;
    scope: string;
    classroom_id: string | null;
    student_ids: string[] | null;
    stale_before: string | null;
    cursor_account_id: string | null;
    batch_size: number | null;
    cooldown_ms: number | null;
    clean_streak: number | null;
    est_batch_ms: number | null;
    processed: number | null;
    succeeded: number | null;
    failed: number | null;
    total: number | null;
    started_at: string | null;
    errors: unknown;
  };

  const platformId = job.platform_id;
  if (!platformId) {
    await failJob(jobId, owner, "Job has no platform_id — use runChunk for legacy jobs");
    return {
      claimed: true,
      done: false,
      aborted: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      total: 0,
    };
  }

  const { data: platform } = await supabaseAdmin
    .from("platforms")
    .select(
      "id, batch_size, base_cooldown_ms, est_batch_ms, max_concurrency, supports_batch_fetch, enabled",
    )
    .eq("id", platformId)
    .maybeSingle<PlatformConfig>();

  const adapter = getAdapter(platformId);
  if (!platform || !adapter) {
    // A platforms row can exist with no adapter — several are registered as
    // configurable slots ahead of implementation. Fail this job loudly instead
    // of looping over accounts nothing can fetch.
    await failJob(
      jobId,
      owner,
      !platform ? `Unknown platform ${platformId}` : `No adapter for ${platformId}`,
    );
    return {
      claimed: true,
      done: false,
      aborted: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      total: 0,
    };
  }

  let cursor: string | null = job.cursor_account_id ?? null;
  const batchSize = platform.batch_size ?? job.batch_size ?? 5;
  const baseCooldown = platform.base_cooldown_ms ?? 3000;
  let cooldownMs = job.cooldown_ms ?? baseCooldown;
  let cleanStreak = job.clean_streak ?? 0;
  let processed = job.processed ?? 0;
  let succeeded = job.succeeded ?? 0;
  let failed = job.failed ?? 0;
  const total = job.total ?? 0;

  const t0 = Date.now();
  const deadline = t0 + budgetMs - TAIL_MS;
  let done = false;
  let batchNo = 0;
  let consecutiveThrottleBatches = 0;

  // Seeded from the job so a slow platform is paced correctly from batch ONE.
  // Each chunk used to start cold and re-learn this, which meant the very first
  // batch of every chunk was sized on a guess.
  //
  // Capped, because the estimate PERSISTS across chunks and a single pathological
  // batch would otherwise poison every future one. Codeforces recorded 47.6s
  // during a submission-history walk; `47631 * 1.5 + 2100` exceeds the whole
  // budget, so the admission test below could never pass again and the job was
  // permanently unable to finish — 12/12 processed, forever "running".
  const EST_CAP_MS = Math.floor((budgetMs - TAIL_MS) / 2);
  let estBatchMs = Math.min(job.est_batch_ms ?? platform.est_batch_ms ?? 12_000, EST_CAP_MS);
  let observedMaxMs = 0;
  let calibrated = false;

  const canFitAnotherBatch = () =>
    Date.now() - t0 + Math.max(estBatchMs * 1.5, observedMaxMs) + cooldownMs < budgetMs - TAIL_MS;

  // The FIRST batch of a chunk is always attempted, however pessimistic the
  // estimate. Overrun is already structurally impossible — every fetch clamps its
  // timeout to the remaining budget — so refusing to start is pure deadlock with
  // no safety benefit. The estimator's job is deciding whether to run a SECOND
  // batch, not whether to do any work at all.
  const shouldRunBatch = () => batchNo === 0 || canFitAnotherBatch();

  log.ok("platform", `✔ claimed ${platformId}`, {
    scope: job.scope,
    cursor: cursor?.slice(0, 8) ?? "START",
    progress: `${processed}/${total}`,
    batchSize,
    cooldownMs,
    estBatchMs,
  });

  while (shouldRunBatch()) {
    batchNo += 1;
    const bStart = Date.now();

    const { data: accounts, error: pageError } = await supabaseAdmin.rpc("platform_account_page", {
      p_platform_id: platformId,
      p_cursor: cursor as string,
      p_limit: batchSize,
      p_max_failures: ACCOUNT_FAILURE_CUTOFF,
      p_scope: job.scope,
      p_classroom_id: job.classroom_id as string,
      p_student_ids: job.student_ids as string[],
      p_stale_before: job.stale_before as string,
    });
    if (pageError) {
      // Never treat a query failure as "queue drained" — that silently marks the
      // job complete having done nothing, which is the bug class the legacy
      // worker's comments already record.
      log.error("platform", `batch ${batchNo}: platform_account_page failed`, pageError);
      throw pageError;
    }
    const page = (accounts ?? []) as AccountRow[];
    if (page.length === 0) {
      log.ok("platform", `queue drained after ${batchNo - 1} batches`);
      done = true;
      break;
    }

    const outcomes = await fetchPage(page, adapter, platform, deadline, cooldownMs);

    let batchOk = 0;
    let batchThrottled = 0;
    let batchBudgetCut = 0;
    const batchErrors: { account_id: string; handle: string; error: string; kind: string }[] = [];

    for (const { account, result } of outcomes) {
      if (result.ok) {
        batchOk++;
        continue;
      }
      const kind = result.error instanceof PlatformError ? result.error.kind : "fail";
      if (kind === "throttle") batchThrottled++;
      if (kind === "budget") batchBudgetCut++;
      batchErrors.push({
        account_id: account.account_id,
        handle: account.handle,
        error: result.error instanceof Error ? result.error.message : String(result.error),
        kind,
      });
      log.warn("platform", `  ✕ ${platformId}/${account.handle}`, {
        kind,
        err: String(result.error instanceof Error ? result.error.message : result.error).slice(
          0,
          160,
        ),
      });
    }

    const batchFailed = page.length - batchOk;
    const lastAccount = page[page.length - 1];

    const batchMs = Date.now() - bStart;
    observedMaxMs = Math.max(observedMaxMs, batchMs);
    estBatchMs = Math.min(
      calibrated ? Math.round(0.7 * estBatchMs + 0.3 * batchMs) : batchMs,
      EST_CAP_MS,
    );
    calibrated = true;

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

    // Budget cuts are excluded from the ratio deliberately: they are our own
    // deadline, and letting them trip the breaker would pause a healthy platform
    // for 15 minutes because we ran a chunk slightly too long.
    const throttleRatio = batchThrottled / page.length;
    if (consecutiveThrottleBatches >= 2 && throttleRatio >= 0.6) {
      log.warn("platform", `⚡ circuit breaker — ${platformId} paused 15m`);
      await supabaseAdmin
        .from("refresh_jobs")
        .update({
          status: "paused",
          resume_after: new Date(Date.now() + 15 * 60_000).toISOString(),
          last_error: `Rate limited by ${platformId} — circuit breaker engaged`,
          cooldown_ms: cooldownMs,
          clean_streak: 0,
          est_batch_ms: estBatchMs,
          lease_owner: null,
          lease_until: null,
        })
        .eq("id", jobId)
        .eq("lease_owner", owner);
      return { claimed: true, done: false, paused: true, processed, succeeded, failed, total };
    }

    const { data: committed, error: commitError } = await supabaseAdmin.rpc(
      "commit_platform_batch",
      {
        p_job_id: jobId,
        p_owner: owner,
        p_expected_cursor: cursor as string,
        p_new_cursor: lastAccount.account_id,
        p_ok: batchOk,
        p_failed: batchFailed,
        p_cooldown_ms: cooldownMs,
        p_clean_streak: cleanStreak,
        p_est_batch_ms: estBatchMs,
        // The ARRAY, not JSON.stringify of one — a stringified array arrives as a
        // jsonb scalar and jsonb_array_length() then raises 22023, which stalls
        // the job on its first failing account.
        p_errors: batchErrors.length > 0 ? batchErrors : null,
        p_done: false,
      },
    );
    if (commitError) {
      log.error("platform", `batch ${batchNo}: commit failed`, commitError);
      throw commitError;
    }
    if (!committed) {
      log.warn("platform", `batch ${batchNo}: commit rejected — lease or cursor moved`);
      return { claimed: true, done: false, aborted: true, processed, succeeded, failed, total };
    }

    cursor = lastAccount.account_id;
    processed += batchOk + batchFailed;
    succeeded += batchOk;
    failed += batchFailed;

    log.ok(
      "platform",
      `batch ${batchNo}: ✓${batchOk} ✕${batchFailed} — ${processed}/${total} in ${batchMs}ms`,
      {
        cooldownMs,
        estBatchMs,
        budgetCut: batchBudgetCut || undefined,
        elapsed: `${Math.round((Date.now() - t0) / 1000)}s/${Math.round(budgetMs / 1000)}s`,
      },
    );

    if (canFitAnotherBatch()) await sleep(cooldownMs);
  }

  if (done) {
    await supabaseAdmin
      .from("refresh_jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        est_batch_ms: estBatchMs,
        lease_owner: null,
        lease_until: null,
      })
      .eq("id", jobId)
      .eq("lease_owner", owner);

    const { data: jobRow } = await supabaseAdmin
      .from("refresh_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (jobRow) {
      await supabaseAdmin.from("scrape_runs").insert({
        source:
          jobRow.scope === "platform"
            ? "cron"
            : jobRow.scope === "classroom"
              ? "classroom"
              : "student",
        classroom_id: jobRow.classroom_id,
        platform_id: platformId,
        started_at: jobRow.started_at ?? new Date().toISOString(),
        completed_at: new Date().toISOString(),
        total_students: jobRow.total,
        success_count: jobRow.succeeded,
        failed_count: jobRow.failed,
        errors: jobRow.errors,
      });
    }
  } else {
    // Hand back on the DATABASE clock. Writing lease_until from here is what
    // stalled jobs before: app clocks drift from Postgres (a dev machine
    // measured 33s ahead), and NULL never satisfies `lease_until < now()`.
    await supabaseAdmin
      .from("refresh_jobs")
      .update({ est_batch_ms: estBatchMs })
      .eq("id", jobId)
      .eq("lease_owner", owner);

    const client = supabaseAdmin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { code?: string } | null }>;
    };
    const { error: releaseError } = await client.rpc("release_refresh_job", {
      p_job_id: jobId,
      p_owner: owner,
    });
    if (releaseError) {
      log.warn(
        "platform",
        `release unavailable (${releaseError.code ?? "?"}) — lease expires in <${leaseSeconds}s`,
      );
    }
  }

  log.ok(
    "platform",
    `■ end ${platformId} — done=${done} ${processed}/${total} after ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  return { claimed: true, done, processed, succeeded, failed, total };
}

type Outcome = { account: AccountRow; result: { ok: true } | { ok: false; error: unknown } };

/**
 * Fetch and persist one page.
 *
 * Uses the adapter's batch path when the platform advertises one — Codeforces'
 * user.info takes ~100 handles, so a whole page of identities costs one request
 * instead of one each.
 */
async function fetchPage(
  page: AccountRow[],
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  platform: PlatformConfig,
  deadline: number,
  cooldownMs: number,
): Promise<Outcome[]> {
  const ctx = { deadline, callGapMs: cooldownMs };

  const persist = async (account: AccountRow, profile: NormalizedProfile) => {
    const outcome = await persistPlatformProfile(
      {
        accountId: account.account_id,
        studentId: account.student_id,
        platformId: platform.id,
        handle: account.handle,
      },
      profile,
    );
    if (!outcome.ok) throw new PlatformError("parse_error", 200, outcome.reason, platform.id);
  };

  const onError = async (account: AccountRow, error: unknown) => {
    await recordFetchFailure(
      {
        accountId: account.account_id,
        studentId: account.student_id,
        platformId: platform.id,
        handle: account.handle,
      },
      error,
    );
  };

  if (platform.supports_batch_fetch && adapter.fetchBatch) {
    const byHandle = new Map(page.map((a) => [a.handle.toLowerCase(), a]));
    // Each account's stored cursor travels with its handle. Without it the
    // adapter has nothing to resume from and every run re-walks the same history.
    const results = await adapter.fetchBatch(
      page.map((a) => ({ handle: a.handle, syncCursor: a.sync_cursor ?? undefined })),
      ctx,
    );
    const out: Outcome[] = [];
    for (const [handle, value] of results) {
      const account = byHandle.get(handle.toLowerCase());
      if (!account) continue;
      if (value instanceof PlatformError) {
        await onError(account, value);
        out.push({ account, result: { ok: false, error: value } });
      } else {
        try {
          await persist(account, value);
          out.push({ account, result: { ok: true } });
        } catch (e) {
          await onError(account, e);
          out.push({ account, result: { ok: false, error: e } });
        }
      }
    }
    // Anything the adapter never reported back still has to be accounted for,
    // or the job's processed count drifts from reality and it never completes.
    for (const account of page) {
      if (!out.some((o) => o.account.account_id === account.account_id)) {
        const err = new PlatformError("fail", 0, "Not returned by batch fetch", platform.id);
        await onError(account, err);
        out.push({ account, result: { ok: false, error: err } });
      }
    }
    return out;
  }

  const settled = await pool(page, platform.max_concurrency ?? 3, async (account) => {
    const profile = await adapter.fetchProfile(account.handle, {
      ...ctx,
      syncCursor: account.sync_cursor ?? undefined,
    });
    await persist(account, profile);
  });

  const out: Outcome[] = [];
  for (let i = 0; i < page.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      out.push({ account: page[i], result: { ok: true } });
    } else {
      await onError(page[i], s.reason);
      out.push({ account: page[i], result: { ok: false, error: s.reason } });
    }
  }
  return out;
}

async function failJob(jobId: string, owner: string, message: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  log.error("platform", message);
  await supabaseAdmin
    .from("refresh_jobs")
    .update({
      status: "failed",
      last_error: message,
      finished_at: new Date().toISOString(),
      lease_owner: null,
      lease_until: null,
    })
    .eq("id", jobId)
    .eq("lease_owner", owner);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
