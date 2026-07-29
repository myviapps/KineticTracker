import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/run")({
  server: {
    handlers: {
      POST: async () => {
        try {
          requireCronSecret();
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const request = getRequest();
        const body: { jobId?: string } = await request.json();
        if (!body.jobId) return Response.json({ error: "Missing jobId" }, { status: 400 });

        const { runChunk } = await import("@/lib/refresh-worker.server");
        const result = await runChunk({ jobId: body.jobId, budgetMs: 50_000 });

        if (!result.done && !result.paused && !result.aborted && !("claimed" in result)) {
          const origin = request.headers.get("origin") ?? request.headers.get("host") ?? "";
          const selfUrl = `https://${origin}/api/public/jobs/run`;
          fetch(selfUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({ jobId: body.jobId }),
            signal: AbortSignal.timeout(1500),
          }).catch(() => {});
        }

        return Response.json(result);
      },
    },
  },
});
