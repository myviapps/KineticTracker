import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSiteSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("google_auth_enabled")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("Error fetching site settings:", error);
    return { google_auth_enabled: true }; // Default safe fallback
  }

  return data;
});

export const updateGoogleAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((enabled: boolean) => enabled)
  .handler(async ({ data: enabled, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role !== "admin") throw new Error("Forbidden");

    const { error } = await supabaseAdmin
      .from("site_settings")
      .update({ google_auth_enabled: enabled })
      .eq("id", 1);

    if (error) {
      throw new Error(error.message);
    }

    return true;
  });
