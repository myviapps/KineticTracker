import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ExternalLink, LogIn, LayoutDashboard } from "lucide-react";

import { searchStudents } from "@/lib/search.functions";
import { getCurrentUserClient } from "@/lib/auth.functions";
import { ThemeToggle } from "@/components/theme-toggle";
import { AlmanacLogo } from "@/components/almanac-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Almanac" },
      { name: "description", content: "Track LeetCode progress across classrooms." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCurrentUserClient().then(({ user }) => setSignedIn(!!user));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Anonymous lookup is an exact roll match server-side, so partial input can only
  // ever come back empty. Don't send it — and say why, instead of rendering
  // "No students found for 'cse'" at someone who typed a valid prefix.
  const minLength = signedIn ? 2 : 3;
  const searchable = debounced.length >= minLength;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", debounced, signedIn],
    queryFn: () => searchStudents({ data: { q: debounced } }),
    enabled: searchable && signedIn !== null,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal nav */}
      <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
        <AlmanacLogo size={28} />
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {signedIn === null ? (
            <Skeleton className="h-8 w-28 sm:w-36" />
          ) : signedIn ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden"
                onClick={() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                }}
                title="Search"
              >
                <Search className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                }}
                className="hidden sm:inline-flex"
              >
                <Search className="mr-1 size-4" /> Search
              </Button>
              <Button asChild variant="default" size="sm" className="px-2 sm:px-3">
                <Link to="/dashboard">
                  <LayoutDashboard className="size-4 sm:mr-1" />
                  <span className="hidden sm:inline">Dashboard</span>
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="/auth">
                <LogIn className="mr-1 size-4" />
                <span className="hidden sm:inline">Staff sign in</span>
                <span className="sm:hidden">Sign in</span>
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center sm:gap-4">
          <AlmanacLogo animated size={56} showText={false} className="mb-1 sm:mb-2" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Track LeetCode Progress
          </h1>
          <p className="max-w-lg text-base text-muted-foreground sm:text-lg">
            {signedIn
              ? "Search your classrooms by name, roll number, or LeetCode ID."
              : "Enter a student's full roll number to see their progress."}
          </p>

          {/* Search */}
          <div className="relative mt-2 w-full sm:mt-4">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={signedIn ? "Search students" : "Student roll number"}
              placeholder={signedIn ? "Search by name, roll, or LeetCode ID…" : "e.g. CSE-26-014"}
              className="w-full rounded-xl border border-border bg-surface py-4 pl-12 pr-4 text-lg placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Results */}
          {debounced.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface text-left">
              {!searchable ? (
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
                      // Short, index-offset entrance so a list of results settles in
                      // sequence rather than snapping in as one block.
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
                          <img src={s.avatar} alt="" className="size-10 rounded-full bg-muted object-cover" />
                        ) : (
                          <div className="grid size-10 place-items-center rounded-full bg-muted font-mono text-sm font-bold">
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{s.name}</span>
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                              {s.roll}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                            {/* No ExternalLink affordance when the handle is masked —
                                there is nothing to open. */}
                            <span className="inline-flex items-center gap-1">
                              @{s.leetcode_id}
                              {!s.masked && <ExternalLink className="size-3" />}
                            </span>
                            {s.classroom_name && <span>· {s.classroom_name}</span>}
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

          {signedIn === false && (
            <p className="mt-8 text-xs text-muted-foreground">
              Personal details are partially hidden on public lookups. Staff members can{" "}
              <Link to="/auth" className="text-primary hover:underline">
                sign in
              </Link>{" "}
              to search their classrooms and manage students.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
