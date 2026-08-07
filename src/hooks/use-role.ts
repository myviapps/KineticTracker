import { useQuery } from "@tanstack/react-query";
import { getCurrentUserClient } from "@/lib/auth.functions";

export const CURRENT_USER_KEY = ["currentUser"] as const;

/**
 * The signed-in user's role and what they're allowed to do, for conditional
 * rendering. Shares one query across every consumer.
 *
 * The capability flags mirror the predicates in `@/lib/authz` one-for-one. That
 * duplication is deliberate — the server is still the authority and re-checks
 * everything — but the UI has to agree with it, because until now it didn't: the
 * classroom page offered "Add students", "Refresh all" and a destructive "Delete
 * classroom" to placement officers, whom every server-side policy treats as
 * read-only. They got a confirmation dialog followed by a Forbidden toast.
 *
 * `isLoading` matters: gate on `canManageStudents` alone and the buttons flash in
 * for a frame before the role arrives.
 */
export function useRole() {
  const { data, isLoading } = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: () => getCurrentUserClient(),
    staleTime: 5 * 60_000,
  });

  const role = data?.role ?? null;

  return {
    user: data?.user ?? null,
    role,
    isLoading,
    isAdmin: role === "admin",
    isPlacementOfficer: role === "placement_officer",
    isFaculty: role === "faculty",
    /** Oversees whole colleges, scoped by college_assignments. */
    isCeo: role === "ceo",
    /** Create/delete classrooms, manage staff, settings, platform refresh. */
    canAdminister: role === "admin",
    /** Add / edit / delete students, refresh a classroom. */
    canManageStudents: role === "admin" || role === "faculty",
    /** See every classroom rather than only assigned ones. */
    canViewAllClassrooms: role === "admin" || role === "placement_officer",
  };
}
