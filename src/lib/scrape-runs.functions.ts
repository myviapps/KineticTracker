import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth, requireAdmin } from "@/integrations/supabase/auth-middleware";

export const listScrapeRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requireAdmin])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data ?? [];
  });
