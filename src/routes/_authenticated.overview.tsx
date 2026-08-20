import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Trophy, Users, Flame, Target, LayoutGrid, Activity, type LucideIcon } from "lucide-react";

import { getOverview } from "@/lib/overview.functions";
import { getPerformanceWindows } from "@/lib/performance.functions";
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
  lensMetric,
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

type ClassroomGains = { today: number; yesterday: number; d7: number; d30: number };

/** Movement windows offered on the classroom leaderboard, in display order. */
const GAIN_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "d7", label: "1W" },
  { id: "d30", label: "30D" },
] as const;

type GainWindow = (typeof GAIN_WINDOWS)[number]["id"];

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Overview — Almanac" }] }),
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

  // Component-local, like the classroom route — see the note above SORT_KEYS
  // there. Filtering the page you are already looking at is not a navigation.
  const [lensId, setLensId] = useState<string>(ALL_LENS);
  const lens = lensFor(lensId, data.platforms);
  const [bucket, setBucket] = useState("all");
  const setLens = (p: string) => {
    setLensId(p);
    setBucket("all");
  };
  const [topN, setTopN] = useState(10);

  /*
    `StudentRow.total` is LeetCode-only (see buckets.ts) — fine for the LeetCode
    behavioral buckets it was built for, wrong for a leaderboard/rank that's
    supposed to reflect whichever platform lens is active. This is the same
    metric `lensStatCards` already uses per-lens; the leaderboard and classroom
    rollup below now follow it instead of always reading `r.total`.
  */
  const almanacById = useMemo(
    () => new Map(data.students.map((s) => [s.id, s.ranks?.almanac_score ?? null])),
    [data.students],
  );
  /** Newly solved per student across each window, for the classroom leaderboard. */
  const gainsById = useMemo(
    () =>
      new Map(
        data.students.map((s) => [s.id, s.gains ?? { today: 0, yesterday: 0, d7: 0, d30: 0 }]),
      ),
    [data.students],
  );
  const metricOf = (r: StudentRow): number =>
    lens.isAll
      ? (almanacById.get(r.id) ?? 0)
      : (lensMetric(statsByStudent.get(r.id)?.[lens.id], lens.rank_metric) ?? 0);

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

  /*
    Movement window on the Classroom Leaderboard — deliberately LOCAL, unlike the
    lens, bucket, trend window, top-N and panel tab above it. Those describe
    which slice of the institution you are looking at, which is what makes a
    filtered view worth sending to someone. This one just re-labels the "+N"
    column on a leaderboard that is already fully determined by the URL, so
    putting it in the address bar adds a param to every link without changing
    what the link shows anyone.
  */
  const [gainWindow, setGainWindow] = useState<GainWindow>("d30");

  /*
    Trend lookback — LOCAL, like the Classroom Leaderboard's movement window.
    It changes how far back one chart looks, not which students the page is
    about, so it does not survive in a shared link and does not need to: the
    recipient opens the same cohort and slides it themselves.
  */
  const [trendDays, setTrendDaysState] = useState(30);
  const setTrendDays = (d: number) => setTrendDaysState(clampTrendDays(d));

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

  /**
   * Problems SOLVED by this student, summed across the platforms in view.
   *
   * Distinct from `metricOf`, which returns the Almanac Score on the "all"
   * lens — a difficulty-WEIGHTED number. Summing that into a card labelled only
   * "Classroom Leaderboard" made every cohort look ~1.5x more productive than
   * it is, and the figure could not be reconciled against the "Avg solved" card
   * one screen up. A leaderboard of cohorts wants the plain count.
   */
  const solvedOf = (r: StudentRow): number => {
    const per = statsByStudent.get(r.id) ?? {};
    return lens.isAll
      ? Object.values(per).reduce((s, p) => s + (p.total_solved ?? 0), 0)
      : (per[lens.id]?.total_solved ?? 0);
  };

  const perClassroom = data.classrooms
    .map((c) => {
      const cRows = rows.filter((r) => classroomIdsOf.get(r.id)?.includes(c.id));
      const total = cRows.reduce((s, r) => s + solvedOf(r), 0);
      const g = (pick: (x: ClassroomGains) => number) =>
        cRows.reduce(
          (s, r) => s + pick(gainsById.get(r.id) ?? { today: 0, yesterday: 0, d7: 0, d30: 0 }),
          0,
        );
      return {
        id: c.id,
        name: c.name,
        students: cRows.length,
        total,
        // Movement beside size: a large cohort standing still should not read
        // the same as a small one sprinting.
        today: g((x) => x.today),
        yesterday: g((x) => x.yesterday),
        d7: g((x) => x.d7),
        d30: g((x) => x.d30),
        avg: cRows.length ? Math.round(total / cRows.length) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // A student in two cohorts is counted in each, so these no longer sum to the
  // headcount. That is correct — but it needs saying on screen.
  const sharedStudents = perClassroom.reduce((s, c) => s + c.students, 0) > rows.length;

  const ranked = [...rows]
    .sort((a, b) => metricOf(b) - metricOf(a))
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

  /*
    The same 30-day window the PerformanceWindows panel renders, shared through
    the query cache rather than fetched twice — identical key and options, so
    the panel and the stat card can never disagree about the number.
  */
  const { data: perf } = useQuery({
    queryKey: ["performance-windows"],
    queryFn: () => getPerformanceWindows({ data: { windows: [7, 30] } }),
    staleTime: 5 * 60_000,
  });
  const windowPlatforms = useMemo(
    () => perf?.windows?.find((w) => w.days === 30)?.platforms ?? [],
    [perf],
  );
  const lensWindow = lens.isAll ? null : windowPlatforms.find((w) => w.platform_id === lens.id);
  const allWindowSolved = windowPlatforms.length
    ? windowPlatforms.reduce<number | null>(
        (a, w) => (w.solved === null ? a : (a ?? 0) + w.solved),
        null,
      )
    : null;

  // Cards stay institution-wide while a chip is selected — same rule as before,
  // and the same reason: recomputing them mid-click made the grid jump.
  const lensCards = useMemo(
    () =>
      lensStatCards({
        lens,
        rows: allRows,
        statsByStudent,
        // Without this, "Avg Score" had no scores to average and rendered "—"
        // permanently. getOverview already returns ranks; nothing else was
        // missing.
        almanacScoreOf: (sid) => almanacById.get(sid) ?? null,
        platforms: data.platforms,
        /*
          The 30-day window now comes from the same PerformanceWindows query the
          panel above uses. It was left undefined on the grounds that the panel
          "already answers the window question" — but the card still rendered,
          as a permanent "—" beside three real numbers, which reads as broken
          rather than as deliberately deferred.
        */
        windowSolved: lens.isAll ? allWindowSolved : (lensWindow?.solved ?? null),
        windowDays: 30,
        activeInWindow: activeStudents,
        firstSnapshotDate: lens.isAll
          ? (windowPlatforms
              .map((w) => w.first_snapshot_date)
              .filter(Boolean)
              .sort()[0] ?? null)
          : (lensWindow?.first_snapshot_date ?? null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lens, allRows, statsByStudent, data.platforms, activeStudents, almanacById, windowPlatforms],
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
          board={ranked.map((r) => ({ id: r.id, name: r.name, roll: r.roll, total: metricOf(r) }))}
          boardMax={rows.length}
          topN={topN}
          onTopN={setTopN}
          animate={chartMotion !== CHART_MOTION_STATIC}
        />

        <div className="mb-8">
          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider">Classroom Leaderboard</h3>
              {/* Which movement window sits beside the total. Ranking always
                  stays on total solved — switching this changes the "+N" only,
                  so cohorts do not reshuffle under the cursor. */}
              <div className="flex items-center gap-1">
                <div className="flex rounded-md border border-border p-0.5" role="group">
                  {GAIN_WINDOWS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => setGainWindow(w.id)}
                      aria-pressed={gainWindow === w.id}
                      className={
                        gainWindow === w.id
                          ? "rounded bg-primary px-2 py-0.5 font-mono text-[10px] font-medium text-primary-foreground"
                          : "rounded px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                      }
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <Users className="ml-1 size-4 text-primary" />
              </div>
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
                  {/* The unit is spelled out. Unlabelled, this number was read as
                      solved when it was in fact the weighted Almanac Score — the
                      whole reason the card was wrong. */}
                  <div className="text-right font-mono">
                    <div className="text-lg font-bold">{c.total.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">
                      solved
                      <span className={c[gainWindow] > 0 ? "ml-1 text-primary" : "ml-1 opacity-60"}>
                        +{c[gainWindow].toLocaleString()}{" "}
                        {GAIN_WINDOWS.find((w) => w.id === gainWindow)?.label.toLowerCase()}
                      </span>
                    </div>
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
