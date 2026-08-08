import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { cronGuard } from "@/integrations/supabase/cron-auth";

const Body = z.object({ jobId: z.string().uuid() });

/**
 * Run one chunk of a legacy (student-scoped) refresh job.
 *
 * There used to be a self-recursive `fetch` here that continued the job by
 * calling this same route again. It was removed for two reasons:
 *
 *   1. It was unreachable. Its guard was `!("claimed" in result)`, but `claimed`
 *      is a required field on ChunkResult and every return path sets it, so the
 *      condition was always false.
 *   2. It built the target URL from the request's own `origin`/`host` header and
 *      attached `Authorization: Bearer ${CRON_SECRET}`. Any caller who could
 *      reach this route could name the host that received the secret.
 *
 * Continuation is already handled: .github/workflows/pump.yml pumps every 10
 * minutes and each chunk resumes from the job's persisted cursor.
 */
export const Route = createFileRoute("/api/public/jobs/run")({
  server: {
    handlers: {
      POST: async () => {
        const denied = cronGuard();
        if (denied) return denied;

        const request = getRequest();
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid or missing jobId" }, { status: 400 });
        }

        const { runChunk } = await import("@/lib/refresh-worker.server");
        return Response.json(await runChunk({ jobId: parsed.data.jobId, budgetMs: 50_000 }));
      },
    },
  },
});
