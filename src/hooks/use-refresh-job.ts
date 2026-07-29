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

    void (async () => {
      // True right after a chunk that ended only because it ran out of time —
      // go straight into the next one instead of waiting for the poll to
      // confirm the lease was released.
      let continueImmediately = false;

      while (!cancelled) {
        const j = jobRef.current;
        if (!j || j.id !== jobId) return;

        if (!continueImmediately) {
          const now = Date.now();
          const leaseExpired = !j.lease_until || new Date(j.lease_until).getTime() <= now;
          const claimable =
            j.status === "queued" ||
            // Only steal a running job once its lease has actually lapsed.
            (j.status === "running" && leaseExpired) ||
            (j.status === "paused" &&
              !!j.resume_after &&
              new Date(j.resume_after).getTime() <= now);

          if (!claimable) {
            // Another worker holds it, or it's cooling off after a rate limit.
            await sleep(3000);
            continue;
          }
        }
        continueImmediately = false;

        let res;
        try {
          res = await withPumpLock(() => runChunk({ data: { jobId } }));
        } catch {
          // Network/auth/timeout — back off, then the lease check retries.
          await sleep(3000);
          continue;
        }

        if (cancelled) return;
        await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });

        // undefined => another tab is pumping. Let it.
        if (!res) {
          await sleep(3000);
          continue;
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
          await sleep(1500);
          continue;
        }
        // Chunk hit its time budget with work left — go again now.
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
