import { createFileRoute } from "@tanstack/react-router";
import { cronGuard } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh")({
  server: {
    handlers: {
      POST: async () => {
        const denied = cronGuard();
        if (denied) return denied;

        // One platform-wide job per enabled platform, not one job overall.
        const { enqueueRefreshFanOut } = await import("@/lib/refresh-enqueue.server");
        const { queued, skipped } = await enqueueRefreshFanOut({ scope: "platform" });

        if (queued.length === 0) {
          return Response.json({ queued: [], skipped, reason: "nothing to queue" });
        }

        /*
          Drain rather than run a single chunk of the first job.

          This runs once a day, so it used to enqueue every platform and then
          advance exactly one of them — leaving the rest entirely dependent on
          the 10-minute GitHub Actions pump. When that pump is misconfigured
          (wrong or missing CRON_SECRET, which authenticates separately from
          this route), nothing else ever ran and jobs sat queued indefinitely
          while the UI showed them as scheduled.

          Draining here doesn't extend the invocation — same 50s wall budget —
          it just spends all of it, so the daily cron alone still makes real
          progress and the pipeline degrades slowly instead of stopping dead.
        */
        const { drainJobs } = await import("@/lib/pump-drain.server");
        const { runs, stopped, error } = await drainJobs({ budgetMs: 50_000 });

        return Response.json({
          queued,
          skipped,
          jobs: runs.length,
          stopped,
          ...(error ? { error } : {}),
          processed: runs.reduce((a, r) => a + r.processed, 0),
          succeeded: runs.reduce((a, r) => a + r.succeeded, 0),
          failed: runs.reduce((a, r) => a + r.failed, 0),
          runs,
        });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run refresh" }),
    },
  },
});
