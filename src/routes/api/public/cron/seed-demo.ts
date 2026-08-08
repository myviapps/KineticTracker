import { createFileRoute } from "@tanstack/react-router";
import { cronGuard } from "@/integrations/supabase/cron-auth";

/**
 * Seed the demo cohort over HTTP.
 *
 * seedMockClassroom has always accepted CRON_SECRET as an alternative to admin
 * auth, but nothing exposed it — the only caller was the dashboard button, which
 * needs a browser and an admin session. That made the demo data impossible to
 * seed from a script or to verify in CI, which is exactly when you want it.
 *
 * Same gate and same shape as the sibling refresh route: a Bearer or
 * x-cron-secret header matching CRON_SECRET. (The `x-vercel-cron: 1`
 * short-circuit was removed — it is a client-suppliable header, so trusting it
 * left this write endpoint open to anyone who sent it.)
 *
 * Idempotent — the underlying function returns the existing classroom untouched
 * if the demo cohort is already there, so this can be called repeatedly.
 */
export const Route = createFileRoute("/api/public/cron/seed-demo")({
  server: {
    handlers: {
      POST: async () => {
        const denied = cronGuard();
        if (denied) return denied;

        try {
          const { seedDemoClassroom } = await import("@/lib/mock.server");
          const result = await seedDemoClassroom(null);
          return Response.json(result);
        } catch (e) {
          return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to seed the demo cohort" }),
    },
  },
});
