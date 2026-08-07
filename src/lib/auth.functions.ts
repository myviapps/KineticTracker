// Re-exported from the generated enum, NOT re-typed. This union was hardcoded
// here, again in use-role.ts, and once more at the top of the generated
// types.ts — so adding 'ceo' to the database left a CEO resolving to `null` on
// the client and seeing nothing, while the server correctly granted them access.
export type { AppRole } from "@/integrations/supabase/app-role";
import type { AppRole } from "@/integrations/supabase/app-role";

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
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { user: null, role: null };

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

  // A user may hold multiple roles; resolve to the most privileged one.
  // Order MUST match ROLE_RANK in @/lib/authz — if the two disagree, the UI
  // renders one role's affordances while the server enforces another's.
  const held = new Set((roles ?? []).map((r) => r.role as AppRole));
  const PRECEDENCE: AppRole[] = ["admin", "ceo", "placement_officer", "faculty"];
  const role: AppRole | null = PRECEDENCE.find((r) => held.has(r)) ?? null;

  return { user, role };
}
