import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireRole } from "@/lib/authz";

export const getSiteSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("google_auth_enabled")
    .eq("id", 1)
    .single();

  if (error) {
    // Fail CLOSED. This used to return `true` on error, which meant a transient
    // database problem silently re-enabled a sign-in method an admin had
    // deliberately turned off. Password sign-in is unaffected, so the degraded
    // state is "one auth method temporarily unavailable" rather than "lockout".
    console.error("Error fetching site settings:", error);
    return { google_auth_enabled: false };
  }

  return data;
});

export const updateGoogleAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireRole("admin")])
  // The TS annotation alone is erased at runtime — this was previously an
  // identity function, so a string or object would flow straight into the UPDATE.
  .validator((d: unknown) => z.boolean().parse(d))
  .handler(async ({ data: enabled }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("site_settings")
      .update({ google_auth_enabled: enabled })
      .eq("id", 1);

    if (error) throw new Error(error.message);

    return true;
  });
