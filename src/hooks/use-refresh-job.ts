import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getActiveRefreshJob, runRefreshJobChunk } from "@/lib/refresh-jobs.functions";
import type { Database } from "@/integrations/supabase/types";

export const REFRESH_JOB_KEY = ["refresh-job"] as const;

type RefreshJob = Database["public"]["Tables"]["refresh_jobs"]["Row"] | null;

/**
 * Read-only view of the active refresh job. Safe to call from any number of
 * components — they all share one query. Does NOT pump; see useRefreshJobPump.
 */
export function useRefreshJobStatus() {
  const query = useQuery({
    queryKey: REFRESH_JOB_KEY,
    queryFn: () => getActiveRefreshJob(),
    // Poll fast while a job exists so progress feels live; slow when idle.
    refetchInterval: (q) => (q.state.data ? 2000 : 15_000),
    // Keep polling while the tab is backgrounded. A 1000-student refresh runs
    // for ~15 minutes and the user will switch away; with the default (false)
    // the pump's view of the job froze and it hammered a dead job forever.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  return { ...query, job: query.data as RefreshJob };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns undefined if another tab already holds the pump lock. */
async function withPumpLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(
    "kinetic-refresh-pump",
    { mode: "exclusive", ifAvailable: true },
    async (lock) => (lock ? fn() : undefined),
  );
}

/**
 * Drives the job forward. MUST be mounted exactly once (in _authenticated.tsx).
 *
 * The loop is keyed on jobId ALONE and re-reads the job from a ref. Depending on
 * status/lease_until here would tear down and cancel the in-flight pump every
 * time the row changed — which is every batch — leaving the job stalled.
 */
export function useRefreshJobPump() {
  const { job } = useRefreshJobStatus();
  const qc = useQueryClient();
  const runChunk = useServerFn(runRefreshJobChunk);

  const jobRef = useRef<RefreshJob>(null);
  jobRef.current = job;

  const lastProcessed = useRef<number | null>(null);
  const lastInvalidate = useRef(0);

  // Refresh the underlying page data as progress advances — throttled, so a
  // 1000-student run doesn't refetch every classroom query every 2 seconds.
  const processed = job?.processed ?? null;
  useEffect(() => {
    if (processed === null) {
      lastProcessed.current = null;
      return;
    }
    if (processed === lastProcessed.current) return;
    lastProcessed.current = processed;
    const now = Date.now();
    if (now - lastInvalidate.current < 5000) return;
    lastInvalidate.current = now;
    qc.invalidateQueries({ queryKey: ["classroom"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  }, [processed, qc]);

  const jobId = job?.id ?? null;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    // Statuses worth pumping. Anything else means the job is over.
    const ACTIVE = new Set(["queued", "running", "paused"]);
    // Give up after this many consecutive rounds that move nothing. Without a
    // cap, a backgrounded tab (TanStack Query pauses polling when the window
    // loses focus, so jobRef goes stale) retried a dead job every few seconds
    // forever. Sized to outlast one lease so a chunk finishing on another tab
    // is waited out rather than abandoned.
    const MAX_IDLE_ROUNDS = 15;
    const IDLE_BACKOFF_MS = 4000;

    void (async () => {
      // True right after a chunk that ended only because it ran out of time —
      // go straight into the next one instead of waiting for the poll to
      // confirm the lease was released.
      let continueImmediately = false;
      let idleRounds = 0;

      while (!cancelled) {
        if (idleRounds >= MAX_IDLE_ROUNDS) return;

        const j = jobRef.current;
        if (!j || j.id !== jobId || !ACTIVE.has(j.status)) return;

        // Deliberately no client-side lease check here. lease_until is written
        // and compared by the Postgres clock, and the browser's clock can be
        // wildly out of step with it (a dev machine measured 33s ahead), so any
        // comparison done here is unreliable. claim_refresh_job is atomic and
        // cheap — just ask, and let the database be the judge.
        continueImmediately = false;

        let res;
        try {
          res = await withPumpLock(() => runChunk({ data: { jobId } }));
        } catch {
          // Network/auth/timeout — back off, then the lease check retries.
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }

        if (cancelled) return;
        await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });

        // undefined => another tab is pumping. Let it.
        if (!res) {
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }
        // The server's view wins over our possibly-stale cached row.
        if (res.jobStatus && !ACTIVE.has(res.jobStatus)) {
          if (res.jobStatus === "completed") {
            toast.success(`Refresh complete — ${res.succeeded} updated, ${res.failed} failed`);
            qc.invalidateQueries({ queryKey: ["classroom"] });
            qc.invalidateQueries({ queryKey: ["overview"] });
          }
          return;
        }
        if (res.done) {
          toast.success(`Refresh complete — ${res.succeeded} updated, ${res.failed} failed`);
          qc.invalidateQueries({ queryKey: ["classroom"] });
          qc.invalidateQueries({ queryKey: ["overview"] });
          return;
        }
        if (res.paused) {
          toast.warning(
            "Refresh paused — LeetCode is rate limiting. It will resume automatically.",
          );
          return;
        }
        if (!res.claimed || res.aborted) {
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }
        // Chunk hit its time budget with work left — go again now.
        idleRounds = 0;
        continueImmediately = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, runChunk, qc]);
}

/** @deprecated use useRefreshJobStatus (read) or useRefreshJobPump (drive) */
export const useRefreshJob = useRefreshJobStatus;
