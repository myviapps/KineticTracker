export type AppRole = "admin" | "placement_officer" | "faculty";

/**
 * Client-side auth + role resolution — reads the localStorage session and the
 * user's own role rows (permitted by the "select own" RLS policy on user_roles).
 * No server call, so it is safe to use in route guards and the sidebar.
 *
 * Sign-in / sign-out run directly against the browser Supabase client
 * (see routes/auth.tsx and components/app-sidebar.tsx). They are deliberately
 * NOT exposed as server functions: a module-level Supabase singleton shared
 * across concurrent server requests would leak sessions between users.
 */
export async function getCurrentUserClient() {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, role: null };

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  // A user may hold multiple roles; resolve to the most privileged one.
  const held = new Set((roles ?? []).map((r) => r.role as AppRole));
  const role: AppRole | null = held.has("admin")
    ? "admin"
    : held.has("placement_officer")
      ? "placement_officer"
      : held.has("faculty")
        ? "faculty"
        : null;

  return { user, role };
}
