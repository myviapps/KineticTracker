import { createFileRoute } from "@tanstack/react-router";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh")({
  server: {
    handlers: {
      POST: async () => {
        try {
          requireCronSecret();
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // One platform-wide job per enabled platform, not one job overall.
        const { enqueueRefreshFanOut } = await import("@/lib/refresh-enqueue.server");
        const { queued, skipped } = await enqueueRefreshFanOut({ scope: "platform" });

        if (queued.length === 0) {
          return Response.json({ queued: [], skipped, reason: "nothing to queue" });
        }

        // Run the first chunk of the first job. The pump picks up the rest —
        // next_platform_job() round-robins, so the other platforms are not
        // waiting on this one to finish.
        const { runPlatformChunk } = await import("@/lib/platform-worker.server");
        const first = queued[0];
        const result = await runPlatformChunk({ jobId: first.jobId, budgetMs: 50_000 });

        return Response.json({ queued, skipped, ran: first.platformId, ...result });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run refresh" }),
    },
  },
});
