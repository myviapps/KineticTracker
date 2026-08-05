import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { searchStudents } from "@/lib/search.functions";
import { useRole } from "@/hooks/use-role";

/**
 * The landing hero and /search share one search implementation and one cache
 * entry — typing in the hero, then clicking through to /search hits a warm
 * cache because the query key is byte-identical (`["search", debounced,
 * signedIn]`).
 *
 * Auth state comes from `useRole()` rather than a raw
 * `getCurrentUserClient().then(...)` effect: with a header AND a hero both
 * needing it, the raw effect would fire twice; the role hook wraps the same
 * call in a shared 5-minute query that is cleared on account switch.
 *
 * The anon min-length guard (3 chars, exact roll) is preserved exactly, and
 * the client-side character guard is screened here so typing `%` doesn't
 * surface as a silent failed request.
 */
export function useStudentSearch() {
  const { user, isLoading } = useRole();
  const signedIn: boolean | null = isLoading ? null : !!user;

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // The server validator rejects characters that could restructure its
  // PostgREST filter. Screen them here too so typing one doesn't surface as a
  // failed query.
  const valid = /^[a-zA-Z0-9\s.\-_@]*$/.test(debounced);

  // Anonymous lookup is an exact roll match server-side, so partial input can
  // only ever come back empty. Don't send it — and say why, instead of
  // rendering "No students found for 'cse'" at someone who typed a valid prefix.
  const minLength = signedIn ? 2 : 3;
  const searchable = debounced.length >= minLength && valid;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", debounced, signedIn],
    queryFn: () => searchStudents({ data: { q: debounced } }),
    enabled: searchable && signedIn !== null,
    staleTime: 30_000,
  });

  return {
    query,
    setQuery,
    debounced,
    signedIn,
    valid,
    minLength,
    searchable,
    results,
    isFetching,
  };
}
