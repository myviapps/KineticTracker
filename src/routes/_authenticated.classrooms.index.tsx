import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Users, ArrowRight, Search, ArrowUpDown } from "lucide-react";

import { listClassrooms } from "@/lib/classrooms.functions";
import { useRole } from "@/hooks/use-role";
import { AnimatedLoader } from "@/components/animated-loader";
import { CohortFilterBar } from "@/components/cohort-filter-bar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ALL_LENS, lensFor, metricLabel } from "@/lib/platform-lens";
import { lastClassroom } from "@/lib/last-classroom";

const classroomsQO = queryOptions({
  queryKey: ["classrooms"],
  queryFn: () => listClassrooms(),
});

function PendingClassrooms() {
  return <AnimatedLoader text="Loading classrooms…" />;
}

type SortKey = "recent" | "name" | "students" | "metric";

export type ClassroomsSearch = { p?: string; q?: string; sort?: SortKey };

export const Route = createFileRoute("/_authenticated/classrooms/")({
  head: () => ({ meta: [{ title: "Classrooms — Almanac" }] }),
  validateSearch: (search: Partial<ClassroomsSearch>): ClassroomsSearch => ({
    p: typeof search.p === "string" && search.p.length <= 50 ? search.p : ALL_LENS,
    q: typeof search.q === "string" && search.q.length <= 100 ? search.q : "",
    sort: (["recent", "name", "students", "metric"] as SortKey[]).includes(search.sort as SortKey)
      ? (search.sort as SortKey)
      : "recent",
  }),
  // The window guard is not cosmetic. `attachSupabaseAuth` is a CLIENT middleware,
  // so a loader that runs during SSR calls listClassrooms with no Authorization
  // header and `requireSupabaseAuth` rejects it — this route threw
  // "Unauthorized: No authorization header provided" on any hard navigation.
  // Every other authenticated route already guarded this; this one didn't.
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(classroomsQO);
    }
  },
  component: ClassroomsListPage,
  pendingComponent: PendingClassrooms,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function ClassroomsListPage() {
  const { data } = useSuspenseQuery(classroomsQO);
  const { canViewAllClassrooms } = useRole();

  const sp = Route.useSearch();
  const navigate = Route.useNavigate();
  // viewTransition: false — filtering this list is not a page change, and the
  // router's default cross-fade fired on every keystroke.
  const set = (patch: Partial<ClassroomsSearch>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      viewTransition: false,
    });

  // Typed value is local; the URL follows on a debounce so the list filters
  // instantly without a navigation per character.
  const [searchInput, setSearchInput] = useState(sp.q ?? "");
  useEffect(() => {
    if (searchInput === (sp.q ?? "")) return;
    const t = setTimeout(() => set({ q: searchInput }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, sp.q]);
  useEffect(() => {
    setSearchInput(sp.q ?? "");
  }, [sp.q]);

  /*
    The cohort you were last in, marked so this page answers "where am I?"
    as well as "where can I go?".

    Read in an effect, never during render: localStorage does not exist on the
    server, so reading it inline would make the first client paint disagree with
    the server markup and React would throw the tree away.
  */
  const [currentId, setCurrentId] = useState<string | null>(null);
  useEffect(() => {
    setCurrentId(lastClassroom());
  }, []);

  const lens = lensFor(sp.p, data.platforms);
  const query = searchInput.toLowerCase().trim();
  const sort = sp.sort ?? "recent";

  /** This cohort's rollup for the selected lens, or null when it has none. */
  const rollupFor = (c: (typeof data.classrooms)[number]) =>
    lens.isAll ? null : (c.platforms.find((p) => p.platform_id === lens.id) ?? null);

  const classrooms = useMemo(() => {
    const filtered = query
      ? data.classrooms.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            (c.description ?? "").toLowerCase().includes(query),
        )
      : data.classrooms;

    const scored = [...filtered];
    if (sort === "name") scored.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "students") scored.sort((a, b) => b.student_count - a.student_count);
    else if (sort === "metric") {
      // Cohorts with nobody on this platform sink to the bottom rather than
      // sorting as if they scored zero.
      const avg = (c: (typeof data.classrooms)[number]) => {
        const r = lens.isAll ? null : (c.platforms.find((p) => p.platform_id === lens.id) ?? null);
        return r && r.metric_count > 0 ? r.metric_sum / r.metric_count : -1;
      };
      scored.sort((a, b) => avg(b) - avg(a));
    }
    // "recent" is the server's own created_at ordering; leave it alone.
    return scored;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.classrooms, query, sort, lens.id, lens.isAll]);

  return (
    <div>
      <div className="mx-auto max-w-[1600px] px-4 pb-4 pt-6 sm:px-6 lg:px-8">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Almanac / Classrooms
        </h1>
        {/* listClassrooms is scoped by role now, so "All Classrooms" would be a lie
            for a faculty member seeing only their assignments. */}
        <h2 className="mt-2 text-3xl font-bold tracking-tight">
          {canViewAllClassrooms ? "All Classrooms" : "My Classrooms"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.classrooms.length} cohort{data.classrooms.length === 1 ? "" : "s"} ·{" "}
          {data.totalStudents} students.
        </p>
      </div>

      <CohortFilterBar
        title={canViewAllClassrooms ? "All Classrooms" : "My Classrooms"}
        subtitle={lens.isAll ? "All platforms" : lens.name}
        platforms={data.platforms}
        value={lens.id}
        onChange={(p) => set({ p })}
        shownCount={classrooms.length}
        totalCount={data.classrooms.length}
      />

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search classrooms…"
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
            {(
              [
                { id: "recent", label: "Recent" },
                { id: "name", label: "Name" },
                { id: "students", label: "Size" },
                // Sorting by a platform metric only means something once a
                // platform is selected.
                ...(lens.isAll
                  ? []
                  : [{ id: "metric", label: `Avg ${metricLabel(lens.rank_metric)}` }]),
              ] as { id: SortKey; label: string }[]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => set({ sort: s.id })}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  sort === s.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {classrooms.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-border p-16 text-center">
              <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {query
                  ? `No classroom matches "${sp.q}".`
                  : canViewAllClassrooms
                    ? "No classrooms yet."
                    : "No classrooms assigned to you yet. Contact your admin."}
              </p>
            </div>
          )}
          {classrooms.map((c, i) => {
            const roll = rollupFor(c);
            const avg = roll && roll.metric_count > 0 ? roll.metric_sum / roll.metric_count : null;
            const coverage =
              roll && c.student_count > 0
                ? Math.round((roll.tracked / c.student_count) * 100)
                : null;
            const isCurrent = c.id === currentId;

            return (
              <Link
                key={c.id}
                to="/classrooms/$id"
                params={{ id: c.id }}
                // Carry the lens into the cohort, so picking Codeforces here and
                // opening a cohort does not silently drop you back on "all".
                search={{ p: lens.id }}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                className={cn(
                  "group animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards rounded-xl border bg-surface p-6 transition-[border-color,box-shadow] hover:border-primary/50 hover:ring-1 hover:ring-primary/25",
                  isCurrent ? "border-primary ring-1 ring-primary/30" : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-bold leading-snug">{c.name}</h3>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                    <Users className="size-4" />
                  </span>
                </div>
                {isCurrent && (
                  <span className="mt-2 inline-block rounded bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
                    Current
                  </span>
                )}
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  {c.description || "No description"}
                </p>

                {/* The selected platform, in this cohort. Coverage is shown next
                    to the metric because an impressive average across 3 of 60
                    students is not an impressive cohort. */}
                {!lens.isAll && (
                  <div className="mt-4 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                    {roll ? (
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-xl font-bold leading-none tabular-nums">
                            {avg !== null ? Math.round(avg).toLocaleString() : "—"}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            avg {metricLabel(lens.rank_metric).toLowerCase()}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {roll.tracked}/{c.student_count}
                          {coverage !== null && <span className="opacity-70"> · {coverage}%</span>}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        nobody on {lens.name} yet
                      </span>
                    )}
                  </div>
                )}

                {/* Coverage dots for every platform this cohort touches — a
                    glance at how broadly the cohort is tracked. */}
                {lens.isAll && c.platforms.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {data.platforms.map((p) => {
                      const r = c.platforms.find((x) => x.platform_id === p.id);
                      if (!r) return null;
                      return (
                        <span
                          key={p.id}
                          title={`${r.tracked} of ${c.student_count} on ${p.name}`}
                          className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {p.name} <span className="text-foreground">{r.tracked}</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-3 font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    {c.student_count} student{c.student_count === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-primary transition-transform group-hover:translate-x-0.5">
                    Open <ArrowRight className="size-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
