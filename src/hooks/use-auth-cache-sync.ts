import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Drops the entire React Query cache whenever the signed-in user changes.
 *
 * Every query key in this app is global — `["classrooms"]`, `["overview"]`,
 * `["currentUser"]`, `["classroom", id]` — none of them carry a user id. Signing
 * out and back in as somebody else is a client-side navigation, so nothing ever
 * evicted the previous account's data and the new user was served it verbatim:
 * their predecessor's cohort list, student names, and — because `useRole` caches
 * for five minutes — their predecessor's ROLE. A faculty member landing on an
 * admin's cache saw Import, Staff, Settings and Scrape History in the sidebar
 * until the role query went stale.
 *
 * The server was never fooled (every server function re-resolves the caller), so
 * the wrong-role UI could only ever produce a Forbidden. The leak was what the
 * screen displayed before that.
 *
 * Keyed on the user ID, not the event: Supabase fires INITIAL_SESSION on load and
 * TOKEN_REFRESHED periodically, and clearing on those would throw away good data
 * on a timer. The first observation is skipped so a normal page load keeps its
 * server-rendered cache.
 */
export function useAuthCacheSync() {
  const queryClient = useQueryClient();
  const router = useRouter();
  /** `undefined` = not yet observed, `null` = signed out. */
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      const previous = lastUserId.current;
      lastUserId.current = userId;

      if (previous === undefined) return; // first observation of this page load
      if (previous === userId) return; // token refresh for the same account

      // Not `invalidateQueries`: that leaves the stale data in place and renders
      // it while the refetch is in flight, which is the exact frame this exists to
      // prevent. `clear` removes it outright so consumers suspend instead.
      queryClient.clear();
      // Router loaders hold their own copies via ensureQueryData.
      router.invalidate();
    });

    return () => subscription.unsubscribe();
  }, [queryClient, router]);
}
