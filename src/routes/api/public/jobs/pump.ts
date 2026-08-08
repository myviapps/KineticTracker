import { createFileRoute } from "@tanstack/react-router";
import { cronGuard } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/pump")({
  server: {
    handlers: {
      POST: async () => {
        const denied = cronGuard();
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Eligibility lives in next_platform_job(), in SQL.
        //
        // It replaced a PostgREST filter chain of two .or() groups. PostgREST ANDs
        // chained .or() groups together, so the predicate was
        //   (queued OR running OR lease expired) AND (paused OR resume_after elapsed)
        // A freshly queued job passes the first group and fails the second —
        // resume_after is NULL, and `NULL <= now()` is NULL, not TRUE. So the pump
        // answered "no eligible job" for the single most common case and only ever
        // picked up jobs that were already paused.
        //
        // Evaluating it in Postgres also fixes the fairness problem the JS version
        // had once jobs became per-platform: it orders by
        // coalesce(started_at, created_at), so a platform that has been waiting
        // longest goes next and a busy one cannot starve the others.
        //
        // Selection is only a HINT — claim_refresh_job re-checks the lease against
        // the Postgres clock and refuses if this guessed wrong, so a race costs one
        // rejected claim, never a double-run.
        const { data: jobId, error: pickError } = await supabaseAdmin.rpc("next_platform_job");
        if (pickError) {
          return Response.json({ error: pickError.message }, { status: 500 });
        }
        if (!jobId) return Response.json({ pumped: false, reason: "no eligible job" });

        const { data: job, error: jobError } = await supabaseAdmin
          .from("refresh_jobs")
          .select("id, platform_id")
          .eq("id", jobId as string)
          .maybeSingle();

        if (jobError) return Response.json({ error: jobError.message }, { status: 500 });
        if (!job) return Response.json({ pumped: false, reason: "job vanished" });

        // platform_id decides which worker owns this job. Legacy jobs (null)
        // keep running through the student-based worker, so a job queued before
        // this deploy finishes on the code that created it rather than being
        // handed to a worker that would read a cursor it does not understand.
        if (job.platform_id) {
          const { runPlatformChunk } = await import("@/lib/platform-worker.server");
          const result = await runPlatformChunk({ jobId: job.id, budgetMs: 50_000 });
          return Response.json({
            pumped: true,
            jobId: job.id,
            platform: job.platform_id,
            ...result,
          });
        }

        const { runChunk } = await import("@/lib/refresh-worker.server");
        const result = await runChunk({ jobId: job.id, budgetMs: 50_000 });

        return Response.json({ pumped: true, jobId: job.id, ...result });
      },
    },
  },
});
