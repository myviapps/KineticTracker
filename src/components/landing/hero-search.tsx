import { useNavigate } from "@tanstack/react-router";
import { Search, ExternalLink } from "lucide-react";

import { useStudentSearch } from "@/hooks/use-student-search";

/**
 * Live search embedded in the hero. Deliberately NO autofocus — autofocusing a
 * marketing page scroll-jumps on mobile. Everything else is the same
 * implementation and cache entry as /search (see use-student-search).
 */
export function HeroSearch() {
  const navigate = useNavigate();
  const { query, setQuery, debounced, signedIn, valid, searchable, results, isFetching } =
    useStudentSearch();

  return (
    // `mx-auto` is load-bearing. This box is max-w-2xl (672px) inside the hero's
    // max-w-3xl (768px) column, so without it the search bar pinned to the left
    // edge and sat 48px off-centre under a perfectly centred headline — measured
    // at 1440px as L336/R432 against the h1's L336/R336.
    <div className="mx-auto w-full max-w-2xl">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={signedIn ? "Search students" : "Student roll number"}
          placeholder={signedIn ? "Search by name, roll, or platform handle…" : "e.g. CSE-26-014"}
          // `px-12` rather than `pl-12 pr-4`: the text is centred, and unequal
          // padding would centre it inside an off-centre box, pushing the value
          // visibly right of the placeholder's apparent middle. The left icon
          // is absolutely positioned, so it does not care either way.
          className="w-full rounded-xl border border-border bg-surface/80 px-12 py-4 text-center text-lg shadow-sm backdrop-blur placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {debounced.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface text-left shadow-lg">
          {!valid ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              Letters, numbers, spaces and . - _ @ only.
            </div>
          ) : !searchable ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {signedIn
                ? "Keep typing — at least 2 characters."
                : "Enter the complete roll number to look up a student."}
            </div>
          ) : isFetching ? (
            <div className="flex items-center justify-center gap-2 px-6 py-6 text-sm text-muted-foreground">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No student matches "{debounced}"
              {!signedIn && (
                <span className="mt-1 block text-xs text-muted-foreground/70">
                  Public lookup needs an exact roll number.
                </span>
              )}
            </div>
          ) : (
            <ul>
              {results.map((s, i) => (
                <li
                  key={s.id}
                  className="animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
                >
                  <button
                    onClick={() => navigate({ to: "/students/$roll", params: { roll: s.roll } })}
                    className={`flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-primary/5 ${
                      i < results.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    {s.avatar ? (
                      <img
                        src={s.avatar}
                        alt=""
                        className="size-10 rounded-full bg-muted object-cover"
                      />
                    ) : (
                      <div className="grid size-10 place-items-center rounded-full bg-muted font-mono text-sm font-bold">
                        {s.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{s.name}</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-3xs font-bold text-primary">
                          {s.roll}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          @{s.leetcode_id}
                          {!s.masked && <ExternalLink className="size-3" />}
                        </span>
                        {s.classroom_names.length > 0 && (
                          <span>· {s.classroom_names.join(" · ")}</span>
                        )}
                        <span>· {s.total_solved} solved</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
