import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowUpDown, ChevronDown, ChevronRight, Download, Trophy } from "lucide-react";

import { getRankings, type RankingRow, type ScoringPlatform } from "@/lib/rankings.functions";
import { AnimatedLoader } from "@/components/animated-loader";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type SortKey = "name" | "almanac" | "college" | "classroom" | "scope";
type SortDir = "asc" | "desc";

type RankingSearch = {
  /** Comma-joined college ids. Empty/absent = "All colleges". */
  colleges?: string;
  /** Comma-joined classroom ids. Empty/absent = "All classrooms" (within whatever `colleges` allows). */
  classrooms?: string;
  sort?: SortKey;
  dir?: SortDir;
};

const qo = queryOptions({ queryKey: ["rankings"], queryFn: () => getRankings() });

const SORT_KEYS: SortKey[] = ["name", "almanac", "college", "classroom", "scope"];

export const Route = createFileRoute("/_authenticated/rankings")({
  head: () => ({ meta: [{ title: "Rankings — Almanac" }] }),
  validateSearch: (search: Partial<RankingSearch>): RankingSearch => ({
    colleges: typeof search.colleges === "string" ? search.colleges : undefined,
    classrooms: typeof search.classrooms === "string" ? search.classrooms : undefined,
    sort: SORT_KEYS.includes(search.sort as SortKey) ? (search.sort as SortKey) : "almanac",
    dir: search.dir === "desc" ? "desc" : "asc",
  }),
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(qo);
    }
  },
  component: RankingsPage,
  pendingComponent: () => <AnimatedLoader text="Loading rankings…" />,
});

function parseIds(s: string | undefined): string[] {
  return s ? s.split(",").filter(Boolean) : [];
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function exportCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((line) => line.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Dense rank (ties share a place, no gap after) — mirrors the classroom page's
 *  client-side `ranksById` memo and the SQL RPC's `dense_rank()`, so a tie reads
 *  the same everywhere in the app. */
function denseRankByScore(rows: RankingRow[]): Map<string, { rank: number; total: number }> {
  const sorted = [...rows].sort((a, b) => b.almanac_score - a.almanac_score);
  const out = new Map<string, { rank: number; total: number }>();
  let place = 0;
  let prevScore: number | null = null;
  for (const r of sorted) {
    if (prevScore === null || r.almanac_score !== prevScore) place += 1;
    prevScore = r.almanac_score;
    out.set(r.id, { rank: place, total: rows.length });
  }
  return out;
}

function RankingsPage() {
  const { data } = useSuspenseQuery(qo);
  const sp = Route.useSearch();
  const navigate = Route.useNavigate();
  // viewTransition: false — filter and sort changes are in-page, and the
  // router's default cross-fade made every checkbox tick look like a reload.
  const setSearchParams = (patch: Partial<RankingSearch>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      viewTransition: false,
    });

  // Every college the caller can reach, from their classrooms — not from
  // `students`, so a freshly assigned college with no ranked students yet
  // still counts toward "do they have a real choice here at all".
  const accessibleCollegeIds = useMemo(
    () => [...new Set(data.classrooms.map((c) => c.college_id).filter(Boolean))] as string[],
    [data.classrooms],
  );
  const collegeFilterVisible = accessibleCollegeIds.length > 1;
  const collegeOptions = useMemo(
    () =>
      accessibleCollegeIds
        .map((id) => ({ id, name: data.colleges.find((c) => c.id === id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [accessibleCollegeIds, data.colleges],
  );

  const selectedCollegeIds = useMemo(
    () => parseIds(sp.colleges).filter((id) => accessibleCollegeIds.includes(id)),
    [sp.colleges, accessibleCollegeIds],
  );
  const effectiveCollegeIds = selectedCollegeIds.length ? selectedCollegeIds : accessibleCollegeIds;

  // Classroom options cascade to whichever colleges are currently selected
  // (or every accessible classroom, if no college is checked).
  const classroomOptions = useMemo(
    () =>
      data.classrooms
        .filter((c) => effectiveCollegeIds.includes(c.college_id ?? ""))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.classrooms, effectiveCollegeIds],
  );
  // Visibility is about the caller's WHOLE scope, not the momentary cascade —
  // someone with 5 classrooms across 2 colleges still gets this filter even in
  // a moment where the college filter has cascaded it down to 1.
  const classroomFilterVisible = data.classrooms.length > 1;

  const selectedClassroomIds = useMemo(
    () => parseIds(sp.classrooms).filter((id) => classroomOptions.some((c) => c.id === id)),
    [sp.classrooms, classroomOptions],
  );
  const effectiveClassroomIds = selectedClassroomIds.length
    ? selectedClassroomIds
    : classroomOptions.map((c) => c.id);

  const filtersVisible = collegeFilterVisible || classroomFilterVisible;

  const visibleStudents = useMemo(
    () =>
      data.students.filter((s) => s.classroom_ids.some((id) => effectiveClassroomIds.includes(id))),
    [data.students, effectiveClassroomIds],
  );

  /*
    Scope rank only means something once the user has EXPLICITLY picked more
    than one classroom or college — it answers "who leads across the specific
    set I chose". Keyed off the selection, not `effective*`: with nothing
    picked, "all classrooms" fills effective* with the whole scope, which would
    switch Scope on by default and make it a duplicate of the Almanac rank.
  */
  const scopeActive = selectedCollegeIds.length > 1 || selectedClassroomIds.length > 1;
  const scopeRanks = useMemo(
    () => (scopeActive ? denseRankByScore(visibleStudents) : new Map()),
    [scopeActive, visibleStudents],
  );

  const showCollegeColumn = useMemo(
    () => new Set(visibleStudents.map((s) => s.college_id).filter(Boolean)).size > 1,
    [visibleStudents],
  );

  const classroomNameById = useMemo(
    () => new Map(data.classrooms.map((c) => [c.id, c.name])),
    [data.classrooms],
  );

  /** The classrooms of this student that are actually in the current selection. */
  const selectedClassroomsOf = (r: RankingRow) =>
    r.classroom_ids
      .filter((id) => effectiveClassroomIds.includes(id))
      .map((id) => {
        const cr = r.classroom_ranks.find((c) => c.classroom_id === id);
        return {
          id,
          name: cr?.classroom_name ?? classroomNameById.get(id) ?? "—",
          rank: cr?.rank ?? null,
          total: cr?.total ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

  const sort = sp.sort ?? "almanac";
  const dir = sp.dir ?? "asc";
  const toggleSort = (key: SortKey) =>
    setSearchParams(
      sort === key ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: key, dir: "asc" },
    );

  const sorted = useMemo(() => {
    const bestClassroomRank = (r: RankingRow) => {
      const ranks = selectedClassroomsOf(r)
        .map((c) => c.rank)
        .filter((n): n is number => n !== null);
      return ranks.length ? Math.min(...ranks) : null;
    };
    const valueOf = (r: RankingRow): number | string | null => {
      switch (sort) {
        case "name":
          return r.name.toLowerCase();
        case "almanac":
          return r.overall_rank;
        case "college":
          return r.college_rank;
        case "classroom":
          return bestClassroomRank(r);
        case "scope":
          return scopeRanks.get(r.id)?.rank ?? null;
      }
    };
    return [...visibleStudents].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      // Nulls always sink, whichever direction is active — "no rank yet" is not
      // a good score, and flipping it to the top on desc would read as a bug.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return dir === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleStudents, sort, dir, scopeRanks, effectiveClassroomIds, classroomNameById]);

  // Student, College & class, Almanac, College, Classroom, [Scope]
  const colCount = 5 + (scopeActive ? 1 : 0);

  function handleExport() {
    const header = [
      "Student",
      "Roll",
      "College",
      "Classroom",
      "Almanac Rank",
      "College Rank",
      "Classroom Rank",
      ...(scopeActive ? ["Scope Rank"] : []),
    ];
    // One line per (student × classroom) so a per-classroom rank is never
    // ambiguous once the file leaves the app.
    const lines = sorted.flatMap((r) => {
      const classes = selectedClassroomsOf(r);
      const scope = scopeRanks.get(r.id)?.rank ?? "";
      const base = (c: { name: string; rank: number | null }) => [
        r.name,
        r.roll,
        r.college_name ?? "",
        c.name,
        r.overall_rank ?? "",
        r.college_rank ?? "",
        c.rank ?? "",
        ...(scopeActive ? [scope] : []),
      ];
      return classes.length ? classes.map(base) : [base({ name: "", rank: null })];
    });
    exportCsv("rankings.csv", header, lines);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
            Almanac / Rankings
          </h1>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Rankings</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {sorted.length} of {data.students.length} students
            {data.scoped ? " in your assigned cohorts" : ""} · ranked by Almanac Score.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            <Download className="size-3" /> Export CSV
          </button>
          <Trophy className="size-8 text-primary/40" />
        </div>
      </div>

      {filtersVisible && (
        <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-border bg-surface p-4">
          {collegeFilterVisible && (
            <MultiSelectDropdown
              label="Colleges"
              options={collegeOptions}
              selectedIds={selectedCollegeIds}
              onToggle={(id) =>
                setSearchParams({
                  colleges: toggleId(selectedCollegeIds, id).join(",") || undefined,
                })
              }
              onClear={() => setSearchParams({ colleges: undefined })}
            />
          )}
          {classroomFilterVisible && (
            <MultiSelectDropdown
              label="Classrooms"
              options={classroomOptions}
              selectedIds={selectedClassroomIds}
              onToggle={(id) =>
                setSearchParams({
                  classrooms: toggleId(selectedClassroomIds, id).join(",") || undefined,
                })
              }
              onClear={() => setSearchParams({ classrooms: undefined })}
            />
          )}
        </div>
      )}

      <ScoreExplainer scoring={data.scoring} />

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th sorted={sort === "name"} dir={dir} onClick={() => toggleSort("name")}>
                Student
              </Th>
              <th className="px-3 py-2">{showCollegeColumn ? "College & class" : "Class"}</th>
              <Th
                right
                sorted={sort === "almanac"}
                dir={dir}
                onClick={() => toggleSort("almanac")}
                title="Rank across every college on the platform"
              >
                Almanac
              </Th>
              <Th
                right
                sorted={sort === "college"}
                dir={dir}
                onClick={() => toggleSort("college")}
                title="Rank within the student's own college"
              >
                College
              </Th>
              <Th
                right
                sorted={sort === "classroom"}
                dir={dir}
                onClick={() => toggleSort("classroom")}
                title="Rank within each of the student's classrooms"
              >
                Classroom
              </Th>
              {scopeActive && (
                <Th
                  right
                  sorted={sort === "scope"}
                  dir={dir}
                  onClick={() => toggleSort("scope")}
                  title="Rank among only the students matching the current filters"
                >
                  Scope
                </Th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-12 text-center text-muted-foreground">
                  {data.students.length === 0
                    ? "No students in your scope yet."
                    : "No students match these filters."}
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const classes = selectedClassroomsOf(r);
              const scope = scopeRanks.get(r.id);
              return (
                <tr key={r.id} className="transition-colors hover:bg-primary/5">
                  <td
                    className="px-3 py-2"
                    title={`Easy ${r.easy} · Medium ${r.medium} · Hard ${r.hard}${
                      r.unrated > 0 ? ` · Unrated ${r.unrated}` : ""
                    } · Almanac Score ${Math.round(r.almanac_score).toLocaleString()}`}
                  >
                    <div className="flex items-center gap-2.5">
                      {r.avatar ? (
                        <img
                          src={r.avatar}
                          alt=""
                          className="size-7 shrink-0 rounded bg-muted object-cover"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <div className="grid size-7 shrink-0 place-items-center rounded bg-muted font-mono text-[10px] font-bold">
                          {r.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          to="/students/$roll"
                          params={{ roll: r.roll }}
                          className="block truncate font-semibold hover:text-primary hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.roll}</div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {showCollegeColumn && (
                      <div className="truncate text-foreground">{r.college_name ?? "—"}</div>
                    )}
                    {classes.length > 0 ? (
                      classes.map((c) => (
                        <div key={c.id} className="truncate font-mono text-[10px] leading-5">
                          {c.name}
                        </div>
                      ))
                    ) : (
                      <div className="font-mono text-[10px] leading-5">—</div>
                    )}
                  </td>

                  <RankCell rank={r.overall_rank} total={r.overall_total} />
                  <RankCell rank={r.college_rank} total={r.college_total} />

                  {/* One line per selected classroom, aligned with the names
                      alongside — this is how a multi-cohort student keeps a
                      single row while still showing a rank per classroom. */}
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {showCollegeColumn && <div className="text-xs">&nbsp;</div>}
                    {classes.length > 0 ? (
                      classes.map((c) => (
                        <div key={c.id} className="text-[11px] leading-5">
                          {c.rank !== null ? (
                            <>
                              <span className="font-bold">#{c.rank}</span>
                              {c.total !== null && (
                                <span className="text-muted-foreground">/{c.total}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] leading-5 text-muted-foreground">—</div>
                    )}
                  </td>

                  {scopeActive && (
                    <RankCell rank={scope?.rank ?? null} total={scope?.total ?? null} />
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankCell({ rank, total }: { rank: number | null; total: number | null }) {
  return (
    <td className="px-3 py-2 text-right font-mono tabular-nums">
      {rank !== null ? (
        <>
          <span className="font-bold">#{rank}</span>
          {total !== null && <span className="text-muted-foreground">/{total}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </td>
  );
}

/** Sortable header cell — mirrors the roster table's `Th` on the classroom page. */
function Th({
  children,
  onClick,
  sorted,
  dir,
  right,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  sorted: boolean;
  dir: SortDir;
  right?: boolean;
  title?: string;
}) {
  return (
    <th className={cn("px-3 py-2", right && "text-right")} title={title}>
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground",
          right && "flex-row-reverse",
          sorted && "text-primary",
        )}
      >
        {children}
        <ArrowUpDown className={cn("size-3", sorted ? "opacity-80" : "opacity-40")} />
        {sorted && <span className="sr-only">{dir === "asc" ? "ascending" : "descending"}</span>}
      </button>
    </th>
  );
}

/**
 * What the number actually means.
 *
 * Weights live on the `platforms` table so an admin can recalibrate without a
 * deploy — which is exactly why this reads them live instead of restating them
 * in prose that would quietly go stale. Naming the enabled platforms is the
 * honest part: the score sums only those, so a reader can see at a glance that
 * activity elsewhere is not being counted.
 */
function ScoreExplainer({ scoring }: { scoring: ScoringPlatform[] }) {
  const [open, setOpen] = useState(false);
  const names = scoring.map((p) => p.name).join(", ");

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        How the Almanac Score works
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-4 animate-in fade-in slide-in-from-top-1">
          <p className="text-sm text-muted-foreground">
            Every rank on this page comes from one difficulty-weighted score, summed across the
            platforms listed below:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {`easy×w_easy + medium×w_medium + hard×w_hard + unrated×w_unrated
  + max(0, (rating − baseline) ÷ 100) × w_rating`}
          </pre>

          {scoring.length === 0 ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-hard">
              No platforms are currently enabled — every score is 0.
            </p>
          ) : (
            <>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Platform</th>
                    <th className="py-1 pr-3 text-right text-easy">Easy</th>
                    <th className="py-1 pr-3 text-right text-medium">Medium</th>
                    <th className="py-1 pr-3 text-right text-hard">Hard</th>
                    <th className="py-1 pr-3 text-right">Unrated</th>
                    <th className="py-1 text-right">Rating</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {scoring.map((p) => (
                    <tr key={p.id} className="border-t border-border/50">
                      <td className="py-1 pr-3 font-sans">{p.name}</td>
                      <td className="py-1 pr-3 text-right">{p.weight_easy}</td>
                      <td className="py-1 pr-3 text-right">{p.weight_medium}</td>
                      <td className="py-1 pr-3 text-right">{p.weight_hard}</td>
                      <td className="py-1 pr-3 text-right">{p.weight_unrated}</td>
                      <td className="py-1 text-right">
                        {p.rating_weight > 0 && p.rating_baseline !== null
                          ? `×${p.rating_weight} over ${p.rating_baseline}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Currently scoring: {names}. Activity on any other platform does not affect these
                ranks.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onToggle,
  onClear,
}: {
  label: string;
  options: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const summary =
    selectedIds.length === 0
      ? `All ${label.toLowerCase()}`
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.name ?? "1 selected")
        : `${selectedIds.length} ${label.toLowerCase()} selected`;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-muted-foreground">{label}</label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 min-w-[200px] items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent"
          >
            <span className="truncate">{summary}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-[240px] overflow-y-auto">
          {selectedIds.length > 0 && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onClear();
                }}
              >
                Clear selection
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={selectedIds.includes(o.id)}
              onSelect={(e) => {
                e.preventDefault();
                onToggle(o.id);
              }}
            >
              {o.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
