import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

/**
 * Seed a mock classroom with fake but realistic-looking data so the UI can be
 * previewed without any scraping.
 *
 * The work lives in mock.server.ts; this is only the auth gate. Splitting them
 * is what lets the CRON_SECRET path actually be reachable from a script — see
 * routes/api/public/cron/seed-demo.
 */
export const seedMockClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Accept CRON_SECRET as an alternative gate to admin auth.
    let isCron = false;
    try {
      requireCronSecret();
      isCron = true;
    } catch {
      /* not a cron call — fall through to the admin check */
    }

    if (!isCron) {
      // Admins only — this writes to shared classroom/student tables.
      const { resolveRole } = await import("@/lib/authz");
      const role = await resolveRole(context.userId);
      if (role !== "admin") throw new Error("Forbidden");
    }

    const { seedDemoClassroom } = await import("./mock.server");
    return seedDemoClassroom(context.userId ?? null);
  });
