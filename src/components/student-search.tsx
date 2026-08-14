import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { Search, Loader2, CornerDownLeft } from "lucide-react";

import { Command, CommandList, CommandItem } from "@/components/ui/command";
import { searchStudents } from "@/lib/search.functions";
import { cn } from "@/lib/utils";

/**
 * Header search for signed-in staff: find a student by roll number (or name /
 * LeetCode handle) and jump straight to their classroom roster, with a
 * per-classroom rank and total solved shown right in the row so the search
 * itself answers "where do they stand" before you even click through.
 *
 * Scoping is entirely server-side — `searchStudents` restricts results to the
 * caller's accessible classrooms, so faculty only ever match students in the
 * classrooms they're assigned to, while admins and placement officers match all.
 * There is deliberately no classroom picker here; the answer depends on who is
 * asking, not on what they select.
 *
 * A student in more than one classroom shows one pill per classroom, each its
 * own link — picking the row itself (click/Enter) goes to the first.
 *
 * cmdk provides the combobox semantics and arrow-key handling. `shouldFilter` is
 * off because filtering happens in Postgres, not over a local list.
 */
export function StudentSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // The server validator rejects characters that could restructure its PostgREST
  // filter. Screen them here too so typing one doesn't surface as a failed query.
  const valid = /^[a-zA-Z0-9\s.\-_@]*$/.test(debounced);
  const searchable = debounced.length >= 2 && valid;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchStudents({ data: { q: debounced } }),
    enabled: searchable,
    staleTime: 30_000,
  });

  // Cmd/Ctrl+K focuses the field. Deliberately NOT "/" — the classroom detail
  // page already binds that to its own in-table search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  /** Jump straight to a classroom roster — that's the point of this search now. */
  function goToClassroom(classroomId: string) {
    setOpen(false);
    setQuery("");
    navigate({ to: "/classrooms/$id", params: { id: classroomId } });
  }

  /**
   * Whole-row select/Enter with no specific classroom pill clicked: go to the
   * student's first classroom (alphabetical, matching how classrooms render).
   * A student with no classroom at all (data anomaly, not the common case)
   * falls back to their profile — there's nowhere else to send them.
   */
  function go(s: { roll: string; classrooms: { id: string; name: string }[] }) {
    const first = s.classrooms[0];
    if (first) {
      goToClassroom(first.id);
      return;
    }
    setOpen(false);
    setQuery("");
    navigate({ to: "/students/$roll", params: { roll: s.roll } });
  }

  const showPanel = open && debounced.length > 0;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Command
        shouldFilter={false}
        loop
        className="overflow-visible bg-transparent"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            onFocus={() => setOpen(true)}
            placeholder="Search roll number…"
            aria-label="Search students by roll number"
            className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-12 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 font-mono text-[9px] text-muted-foreground lg:block">
            ⌘K
          </kbd>
        </div>

        {showPanel && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] origin-top overflow-hidden rounded-lg border border-border bg-popover shadow-xl animate-in fade-in slide-in-from-top-1">
            <CommandList className="max-h-[min(24rem,60vh)]">
              {!valid ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Letters, numbers, spaces and . - _ @ only.
                </p>
              ) : !searchable ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Keep typing — at least 2 characters.
                </p>
              ) : isFetching && results.length === 0 ? (
                <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No students in your classrooms match "{debounced}".
                </p>
              ) : (
                <div className="p-1">
                  {results.map((s) => (
                    <CommandItem
                      key={s.id}
                      // cmdk matches on `value`; keep it unique so two students
                      // with the same name stay individually selectable.
                      value={`${s.roll}-${s.id}`}
                      onSelect={() => go(s)}
                      className="cursor-pointer gap-3 px-2 py-2"
                    >
                      {s.avatar ? (
                        <img
                          src={s.avatar}
                          alt=""
                          className="size-7 shrink-0 rounded bg-muted object-cover"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <div className="grid size-7 shrink-0 place-items-center rounded bg-muted font-mono text-[10px] font-bold">
                          {s.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                          <span>{s.roll}</span>
                          {s.classrooms.length > 0 ? (
                            s.classrooms.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                title={`Open ${c.name}`}
                                // Its own destination within the row — a student in
                                // several cohorts needs to pick which one, not just
                                // land on whichever the row itself defaults to.
                                onClick={(e) => {
                                  e.stopPropagation();
                                  goToClassroom(c.id);
                                }}
                                className="rounded border border-border/60 px-1 py-0.5 hover:border-primary hover:text-primary"
                              >
                                {c.name}
                                {c.rank && <span className="opacity-70"> #{c.rank}</span>}
                              </button>
                            ))
                          ) : (
                            <span className="opacity-60">no classroom</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                        <div>{s.total_solved} solved</div>
                        {s.college_rank && (
                          <div className="opacity-70">
                            #{s.college_rank}/{s.college_total} college
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                  <div className="flex items-center justify-end gap-1 border-t border-border px-2 pb-1 pt-1.5 font-mono text-[9px] text-muted-foreground">
                    <CornerDownLeft className="size-2.5" /> to open
                  </div>
                </div>
              )}
            </CommandList>
          </div>
        )}
      </Command>
    </div>
  );
}
