import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { getActiveRefreshJob, runRefreshJobChunk } from "@/lib/refresh-jobs.functions";
import type { Database } from "@/integrations/supabase/types";

type RefreshJob = Database["public"]["Tables"]["refresh_jobs"]["Row"] | null;

export function useRefreshJob() {
  const qc = useQueryClient();
  const runChunk = useServerFn(runRefreshJobChunk);
  const processedRef = useRef(0);

  const query = useQuery({
    queryKey: ["refresh-job"],
    queryFn: () => getActiveRefreshJob(),
    refetchInterval: (q) => (q.state.data ? 2000 : 30_000),
    staleTime: 1000,
  });

  const job = query.data as RefreshJob;

  useEffect(() => {
    if (!job) { processedRef.current = 0; return; }
    if (job.processed !== processedRef.current) {
      processedRef.current = job.processed;
      const t = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["classroom"] });
        qc.invalidateQueries({ queryKey: ["overview"] });
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [job?.processed, qc]);

  useEffect(() => {
    if (!job) return;
    const isActive = job.status === "queued" || job.status === "running";
    const isExpired = job.status === "running" && job.lease_until && new Date(job.lease_until) < new Date();
    if (!isActive && !isExpired && job.status !== "paused") return;

    const controller = new AbortController();

    navigator.locks.request("kinetic-refresh-pump", { mode: "exclusive" }, async () => {
      if (controller.signal.aborted) return;
      try {
        await runChunk({ data: { jobId: job.id } });
      } catch {
        // Pump failed — next poll will retry
      }
    }).catch(() => {});

    return () => controller.abort();
  }, [job?.id, job?.status, runChunk]);

  return query;
}
