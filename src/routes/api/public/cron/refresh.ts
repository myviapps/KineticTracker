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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Enqueue a platform-wide refresh job
        const { data: jobId, error } = await supabaseAdmin.rpc("enqueue_refresh_job", {
          p_scope: "platform",
        });
        if (error) return Response.json({ error: error.message }, { status: 500 });

        // Run the first chunk
        const { runChunk } = await import("@/lib/refresh-worker.server");
        const result = await runChunk({ jobId, budgetMs: 50_000 });

        return Response.json({ jobId, ...result });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run refresh" }),
    },
  },
});
