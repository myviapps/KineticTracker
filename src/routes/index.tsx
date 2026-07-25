import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ExternalLink, Terminal, LogIn } from "lucide-react";

import { searchStudents } from "@/lib/search.functions";
import { ThemeToggle, useTheme } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kinetic — LeetCode Classroom Tracker" },
      { name: "description", content: "Track LeetCode progress across classrooms." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [theme] = useTheme();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchStudents({ data: { q: debounced } }),
    enabled: debounced.length >= 2,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal nav */}
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Terminal className="size-4" strokeWidth={2.5} />
          </div>
          <span className="font-mono text-sm font-bold tracking-tight">
            KINETIC<span className="text-primary">/</span>LC
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline" size="sm">
            <Link to="/auth">
              <LogIn className="mr-1 size-4" /> Staff sign in
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Track LeetCode Progress
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Search for a student by name, roll number, email, or LeetCode ID.
          </p>

          {/* Search */}
          <div className="relative mt-10">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, roll, email, or LeetCode ID…"
              className="w-full rounded-xl border border-border bg-surface py-4 pl-12 pr-4 text-lg placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Results */}
          {debounced.length >= 2 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface text-left">
              {results.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No students found for "{debounced}"
                </div>
              ) : (
                <ul>
                  {results.map((s, i) => (
                    <li key={s.id}>
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
                            <span className="inline-flex items-center gap-1">
                              @{s.leetcode_id} <ExternalLink className="size-3" />
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

          {/* Footer hint */}
          <p className="mt-8 text-xs text-muted-foreground">
            Staff members can{" "}
            <Link to="/auth" className="text-primary hover:underline">
              sign in
            </Link>{" "}
            to manage classrooms, import students, and refresh stats.
          </p>
        </div>
      </main>
    </div>
  );
}
