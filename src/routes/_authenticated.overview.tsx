import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Trophy,
  Users,
  Flame,
  Target,
  Filter,
  X,
  LayoutGrid,
  Activity,
  CalendarDays,
  Zap,
  Repeat,
  TrendingUp,
  MoonStar,
  Hammer,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { getOverview } from "@/lib/overview.functions";
import { toStudentRow, type StudentRow } from "@/lib/buckets";
import { StudentListDialog } from "@/components/student-list-dialog";
import { CHART_MOTION, CHART_MOTION_STATIC } from "@/lib/chart-motion";
import { RefreshButton } from "@/components/refresh-button";
import { useRole } from "@/hooks/use-role";
import { PerformanceWindows } from "@/components/performance-windows";
import { useRefreshJobStatus } from "@/hooks/use-refresh-job";
import { AnimatedLoader } from "@/components/animated-loader";
import { CohortFilterBar } from "@/components/cohort-filter-bar";
import { CohortToolbar } from "@/components/cohort-toolbar";
import { LensStatRow } from "@/components/lens-stat-row";
import { CohortInsightPanel } from "@/components/cohort-insight-panel";
import { clampTrendDays } from "@/components/trend-window-control";
import {
  ALL_LENS,
  lensFor,
  lensFilters,
  applyLensFilter,
  lensStatCards,
} from "@/lib/platform-lens";

const qo = queryOptions({ queryKey: ["overview"], queryFn: () => getOverview() });

/** Icon per lens stat-card label; see LENS_ICONS on the classroom route. */
const OVERVIEW_ICONS: Record<string, LucideIcon> = {
  Students: Users,
  "On platform": Users,
  Coverage: Users,
  "Platforms tracked": LayoutGrid,
  "Avg Almanac Score": Trophy,
  "Solved (all platforms)": Target,
  "Total solved": Target,
  "Problems solved": Target,
  "Avg / student": Target,
  "Avg rating": Trophy,
  "Cohort best": Trophy,
  "Avg score": Trophy,
  "Top score": Trophy,
  "Solved (30d)": Flame,
  "Active (30d)": Activity,
};

/** Same shape and rationale as the classroom route — see ClassroomSearch. */
export type OverviewSearch = { p?: string; b?: string; d?: number };

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Overview — Almanac" }] }),
  validateSearch: (search: Partial<OverviewSearch>): OverviewSearch => ({
    p: typeof search.p === "string" && search.p.length <= 50 ? search.p : ALL_LENS,
    b: typeof search.b === "string" && search.b.length <= 50 ? search.b : "all",
    d: clampTrendDays(search.d, 30),
  }),
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(qo);
    }
  },
  component: OverviewPage,
  pendingComponent: PendingOverview,
});

function PendingOverview() {
  return <AnimatedLoader text="Loading overview…" />;
}

function OverviewPage() {
  const { data } = useSuspenseQuery(qo);
  const { canAdminister, role } = useRole();
  const { status: refreshStatus } = useRefreshJobStatus();
  // See the note in chart-motion.ts: a live refresh job invalidates this query
  // every few seconds, and replaying the draw-in each time reads as flicker.
  const chartMotion =
    refreshStatus === "running" || refreshStatus === "queued" ? CHART_MOTION_STATIC : CHART_MOTION;

  // Annotation removed deliberately: it claimed the row was only
  // `{ student_id: string }`, which discarded every stats column the server
  // actually sends and hid the fact that toStudentRow reads streak and ranking
  // off it. Inference gives the true shape.
  const statsById = new Map(data.stats.map((s) => [s.student_id, s]));

  const allRows = data.students.map((st) =>
    toStudentRow({ ...st, stats: statsById.get(st.id) ?? null }),
  );

  const statsByStudent = useMemo(
    () => new Map(data.students.map((s) => [s.id, s.platformStats ?? {}])),
    [data.students],
  );

  // Lens + filter live in the URL here too, so a filtered institution view is a
  // link rather than something you have to describe over a call.
  const sp = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearchParams = (patch: Partial<OverviewSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const lens = lensFor(sp.p, data.platforms);
  const setLens = (p: string) => setSearchParams({ p, b: "all" });
  const bucket = sp.b ?? "all";
  const setBucket = (b: string) => setSearchParams({ b });
  const trendDays = sp.d ?? 30;
  const setTrendDays = (d: number) => setSearchParams({ d: clampTrendDays(d) });

  // Counts stay cohort-wide so the chips keep their meaning while a filter is
  // applied — otherwise every chip but the active one reads 0.
  const lensFilterSet = useMemo(
    () => lensFilters(lens, allRows, statsByStudent),
    [lens, allRows, statsByStudent],
  );
  const rows = useMemo(
    () => applyLensFilter(lens, allRows, statsByStudent, bucket),
    [lens, allRows, statsByStudent, bucket],
  );

  /** Which bucket's roster is open in the dialog, if any. */
  const [roster, setRoster] = useState<string | null>(null);

  const [topN, setTopN] = useState(10);

  const sumRows = (list: StudentRow[]) =>
    list.reduce(
      (a, r) => {
        a.total += r.total;
        a.easy += r.easy;
        a.medium += r.medium;
        a.hard += r.hard;
        a.today += r.today;
        a.week += r.week;
        a.month += r.month;
        return a;
      },
      { total: 0, easy: 0, medium: 0, hard: 0, today: 0, week: 0, month: 0 },
    );

  /*
    The stat cards stay cohort-wide while a bucket filter is active — the
    classroom page does the same. Clicking a bucket used to recompute every
    card above the fold, so the numbers jumped mid-click and the grid felt like
    it was re-laying-out. Charts below the banner still follow the filter.
  */
  const allTotals = sumRows(allRows);
  const totals = sumRows(rows);
  const activeStudents = allRows.filter((r) => r.last30 > 0).length;

  /*
    Built once. The previous version nested `data.students.find()` inside
    `rows.filter()` inside a `.map()` over classrooms — 20 cohorts x 1000 students
    is 20M comparisons per render, on a page that re-renders every few seconds
    while a refresh job is advancing.
  */
  const classroomIdsOf = new Map(data.students.map((s) => [s.id, s.classroom_ids]));
  const classroomNameById = new Map(data.classrooms.map((c) => [c.id, c.name]));

  const namesFor = (studentId: string) =>
    (classroomIdsOf.get(studentId) ?? [])
      .map((id) => classroomNameById.get(id))
      .filter((n): n is string => !!n)
      .sort();

  const perClassroom = data.classrooms
    .map((c) => {
      const cRows = rows.filter((r) => classroomIdsOf.get(r.id)?.includes(c.id));
      return {
        id: c.id,
        name: c.name,
        students: cRows.length,
        total: cRows.reduce((s, r) => s + r.total, 0),
        today: cRows.reduce((s, r) => s + r.today, 0),
        week: cRows.reduce((s, r) => s + r.week, 0),
        avg: cRows.length ? Math.round(cRows.reduce((s, r) => s + r.total, 0) / cRows.length) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // A student in two cohorts is counted in each, so these no longer sum to the
  // headcount. That is correct — but it needs saying on screen.
  const sharedStudents = perClassroom.reduce((s, c) => s + c.students, 0) > rows.length;

  const ranked = [...rows]
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((r) => ({ ...r, classrooms: namesFor(r.id) }));

  /*
    Zero-filled on purpose, unlike the classroom page's snapshot series.

    This one reads LeetCode's submission_calendar, which is a complete record of
    every day — a day missing from it means zero submissions, not missing data.
    So every day in the window is a real data point and the count below is
    honestly `trendDays` of `trendDays`.
  */
  const trend: { day: string; solved: number }[] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = String(
      Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000),
    );
    let sum = 0;
    for (const r of rows) sum += r.calendar[key] ?? 0;
    trend.push({ day: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, solved: sum });
  }

  // Week/month performance is an oversight view: it answers "how is the
  // institution trending", which is a CEO's and a placement officer's question.
  // Faculty already have per-cohort activity on the classroom page.
  const showPerformance = role === "ceo" || role === "placement_officer" || canAdminister;

  // The trend line and the difficulty donut both read LeetCode-only fields
  // (submission_calendar and student_stats), so they only claim to describe the
  // page when the lens is LeetCode or the cross-platform overview.
  const showLeetcodeTrend = lens.isAll || lens.id === "leetcode";

  /*
    LeetCode's calendar-derived figures — real, but they exist on exactly one
    platform, so they go in the disclosure rather than making the primary row
    change length as you switch lens.
  */
  const leetcodeExtraStats = useMemo(
    () =>
      lens.id !== "leetcode"
        ? []
        : [
            {
              label: "Submissions this week",
              value: allTotals.week.toLocaleString(),
              hint: "UTC Mon–today",
            },
            {
              label: "Submissions today",
              value: allTotals.today.toLocaleString(),
              hint: "UTC day · at last sync",
            },
          ],
    [lens.id, allTotals],
  );

  /** Distribution fallback for lenses with no difficulty split. */
  const bandHistogram = useMemo(
    () =>
      lensFilterSet.filters
        .filter((f) => f.id !== "all")
        .map((f) => ({ label: f.label, count: f.count })),
    [lensFilterSet],
  );

  // Cards stay institution-wide while a chip is selected — same rule as before,
  // and the same reason: recomputing them mid-click made the grid jump.
  const lensCards = useMemo(
    () =>
      lensStatCards({
        lens,
        rows: allRows,
        statsByStudent,
        platforms: data.platforms,
        // The overview has no per-cohort snapshot query of its own; the
        // PerformanceWindows panel above already answers the window question at
        // institution scope, so these stay undefined rather than being faked.
        windowSolved: undefined,
        activeInWindow: activeStudents,
      }),
    [lens, allRows, statsByStudent, data.platforms, activeStudents],
  );

  return (
    // Same three-band shell as the classroom page: header scrolls, lens pins.
    <div>
      <div className="mx-auto max-w-[1600px] px-4 pb-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
              Almanac / Overview
            </h1>
            {/* This page is reachable by faculty, whose data the server scopes to their
              own assignments — so it can't call itself a cross-classroom Command
              Center for everyone. `data.scoped` comes from the server's own view of
              the caller, not a client guess. */}
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              {data.scoped ? "My Cohorts" : "Command Center"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.scoped
                ? `Your ${data.classrooms.length} assigned cohort${data.classrooms.length === 1 ? "" : "s"} · ${data.students.length} students.`
                : `Cross-classroom stats across ${data.classrooms.length} cohorts and ${data.students.length} students.`}
            </p>
          </div>
          {/* Platform refresh is admin-only server-side; this button used to render for
            placement officers, where it could only ever return Forbidden. */}
          {canAdminister && (
            <div className="flex gap-2">
              <RefreshButton scope="platform" />
            </div>
          )}
        </div>
      </div>

      <CohortFilterBar
        title={data.scoped ? "My Cohorts" : "Command Center"}
        subtitle={lens.isAll ? "All platforms" : lens.name}
        platforms={data.platforms}
        value={lens.id}
        onChange={setLens}
        shownCount={rows.length}
        totalCount={allRows.length}
      />

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {showPerformance && (
          <div className="mb-8">
            <PerformanceWindows />
          </div>
        )}

        {/* ZONE 1 — four cards, the rest folded away. Classrooms is prepended
            because "how many cohorts" is this page's own headline number. */}
        <LensStatRow
          cards={{
            primary: [
              {
                label: "Classrooms",
                value: data.classrooms.length.toLocaleString(),
                hint: `${data.students.length} students`,
              },
              ...lensCards.primary.slice(1),
            ],
            secondary: [lensCards.primary[0], ...lensCards.secondary],
          }}
          icons={OVERVIEW_ICONS}
          fallbackIcon={Target}
          extra={leetcodeExtraStats}
        />

        {/* ZONE 2 — the chips, as chips. These were nine full-width tiles, which
            is a whole screen of counters before any content. Clicking still
            opens the roster dialog. */}
        <CohortToolbar
          search=""
          onSearch={() => {}}
          hideSearch
          filters={lensFilterSet}
          value={bucket}
          onFilter={(id) => {
            setBucket(id);
            if (id !== "all") setRoster(id);
          }}
        />

        {/* ZONE 3 — one panel, three tabs. Was a 2-col chart row plus a
            separate 420px leaderboard card. */}
        <CohortInsightPanel
          title={lens.isAll ? "All platforms" : lens.name}
          trend={showLeetcodeTrend ? trend : []}
          trendEmptyNote={`${lens.name} publishes no daily submission feed — see the performance panel above`}
          trendWindowDays={trendDays}
          onTrendWindowDays={showLeetcodeTrend ? setTrendDays : undefined}
          difficulty={
            showLeetcodeTrend
              ? { easy: totals.easy, medium: totals.medium, hard: totals.hard }
              : null
          }
          bands={bandHistogram}
          board={ranked.map((r) => ({ id: r.id, name: r.name, roll: r.roll, total: r.total }))}
          boardMax={rows.length}
          topN={topN}
          onTopN={setTopN}
          animate={chartMotion !== CHART_MOTION_STATIC}
        />

        <div className="mb-8">
          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider">Classroom Leaderboard</h3>
              <Users className="size-4 text-primary" />
            </div>
            {sharedStudents && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                Students in more than one cohort are counted in each, so these add up to more than
                the headcount.
              </p>
            )}
            <div className="space-y-2">
              {perClassroom.map((c, i) => (
                <Link
                  key={c.id}
                  to="/classrooms/$id"
                  params={{ id: c.id }}
                  className="flex items-center gap-3 rounded border border-border bg-background p-3 transition-colors hover:border-primary/50"
                >
                  <div className="grid size-8 place-items-center rounded bg-primary/10 font-mono text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {c.students} students · avg {c.avg}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-lg font-bold">{c.total.toLocaleString()}</div>
                    <div className="text-[10px] text-primary">+{c.today} today</div>
                  </div>
                </Link>
              ))}
              {perClassroom.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No classrooms yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <StudentListDialog
          open={roster !== null}
          onOpenChange={(o) => !o && setRoster(null)}
          title={lensFilterSet.filters.find((b) => b.id === roster)?.label ?? "Students"}
          students={(roster ? applyLensFilter(lens, allRows, statsByStudent, roster) : []).map(
            (r) => ({
              ...r,
              classrooms: namesFor(r.id),
            }),
          )}
        />
      </div>
    </div>
  );
}
