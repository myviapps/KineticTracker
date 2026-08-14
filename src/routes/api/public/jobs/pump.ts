import { createFileRoute } from "@tanstack/react-router";
import { cronGuard } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/pump")({
  server: {
    handlers: {
      POST: async () => {
        const denied = cronGuard();
        if (denied) return denied;

        /*
          Drains as many chunks as fit in the budget rather than running exactly
          one and returning. A chunk that finishes early used to hand back the
          rest of its 50s while other platforms sat queued — at one invocation
          per 10 minutes that wasted runway is the difference between a queue
          that drains and one that crawls. See pump-drain.server.ts.

          Job selection and lease safety are unchanged: next_platform_job() is
          only a HINT, and claim_refresh_job re-checks the lease against the
          Postgres clock, so a race costs one rejected claim, never a double-run.
        */
        const { drainJobs } = await import("@/lib/pump-drain.server");
        const { runs, stopped, error } = await drainJobs({ budgetMs: 50_000 });

        if (error) return Response.json({ error }, { status: 500 });
        if (runs.length === 0) return Response.json({ pumped: false, reason: stopped });

        return Response.json({
          pumped: true,
          jobs: runs.length,
          stopped,
          processed: runs.reduce((a, r) => a + r.processed, 0),
          succeeded: runs.reduce((a, r) => a + r.succeeded, 0),
          failed: runs.reduce((a, r) => a + r.failed, 0),
          runs,
        });
      },
    },
  },
});
