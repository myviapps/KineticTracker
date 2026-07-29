import { createFileRoute } from "@tanstack/react-router";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/pump")({
  server: {
    handlers: {
      POST: async () => {
        try {
          requireCronSecret();
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job } = await supabaseAdmin
          .from("refresh_jobs")
          .select("*")
          .in("status", ["queued", "running", "paused"])
          .or("status.eq.queued,status.eq.running,lease_until.lt.now()")
          .or("status.eq.paused,resume_after.lte.now()")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!job) return Response.json({ pumped: false, reason: "no eligible job" });

        const { runChunk } = await import("@/lib/refresh-worker.server");
        const result = await runChunk({ jobId: job.id, budgetMs: 50_000 });

        return Response.json({ pumped: true, jobId: job.id, ...result });
      },
    },
  },
});
