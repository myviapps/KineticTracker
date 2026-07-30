import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { useState } from "react";
import { Trophy, Users, Flame, Target, Filter, X } from "lucide-react";

import { getOverview } from "@/lib/overview.functions";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { toStudentRow, bucketCounts, filterBucket, BUCKETS, type BucketId } from "@/lib/buckets";
import { LeaderboardBars } from "@/components/leaderboard-bars";
import { TopNControl } from "@/components/top-n-control";
import { StudentListDialog } from "@/components/student-list-dialog";
import { cn } from "@/lib/utils";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION, CHART_MOTION_STATIC } from "@/lib/chart-motion";
import { RefreshButton } from "@/components/refresh-button";
import { useRole } from "@/hooks/use-role";
import { useRefreshJobStatus } from "@/hooks/use-refresh-job";
import { AnimatedLoader } from "@/components/animated-loader";

const qo = queryOptions({ queryKey: ["overview"], queryFn: () => getOverview() });

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
  const { canAdminister } = useRole();
  const { job } = useRefreshJobStatus();
  // See the note in chart-motion.ts: a live refresh job invalidates this query
  // every few seconds, and replaying the draw-in each time reads as flicker.
  const chartMotion =
    job && (job.status === "running" || job.status === "queued")
      ? CHART_MOTION_STATIC
      : CHART_MOTION;

  const statsById = new Map(data.stats.map((s: any) => [s.student_id, s]));

  const allRows = data.students.map((st) =>
    toStudentRow({ ...st, stats: statsById.get(st.id) ?? null }),
  );

  // Bucket counts stay cohort-wide so the cards keep their meaning while a
  // filter is applied — otherwise every card but the active one reads 0.
  const buckets = bucketCounts(allRows);

  const [bucket, setBucket] = useState<BucketId>("all");
  const rows = filterBucket(allRows, bucket);
  const activeBucket = BUCKETS.find((b) => b.id === bucket);

  /** Which bucket's roster is open in the dialog, if any. */
  const [roster, setRoster] = useState<BucketId | null>(null);

  const [topN, setTopN] = useState(10);

  const totals = rows.reduce(
    (a, r) => {
      a.total += r.total; a.easy += r.easy; a.medium += r.medium; a.hard += r.hard;
      a.today += r.today; a.week += r.week; a.month += r.month;
      return a;
    },
    { total: 0, easy: 0, medium: 0, hard: 0, today: 0, week: 0, month: 0 },
  );

  const activeStudents = rows.filter((r) => r.last30 > 0).length;

  const perClassroom = data.classrooms
    .map((c) => {
      const cRows = rows.filter((r) =>
        data.students.find((s) => s.id === r.id)?.classroom_id === c.id,
      );
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

  // The overview spans cohorts, so a name alone doesn't say who you're looking at.
  const classroomOf = new Map(
    data.students.map((s) => [
      s.id,
      data.classrooms.find((c) => c.id === s.classroom_id)?.name ?? null,
    ]),
  );

  const ranked = [...rows]
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map((r) => ({ ...r, classroom: classroomOf.get(r.id) ?? null }));

  const [cEasy, cMedium, cHard, cSurface, cBorder, cMutedFg, cPrimary] = useCssVars(
    "--easy", "--medium", "--hard", "--surface", "--border", "--muted-foreground", "--primary",
  );

  const [activeDiff, setActiveDiff] = useState<number | null>(null);
  const diff = [
    { name: "Easy", value: totals.easy, color: cEasy },
    { name: "Medium", value: totals.medium, color: cMedium },
    { name: "Hard", value: totals.hard, color: cHard },
  ];
  const totalSolved = totals.total;
  const center = activeDiff != null ? diff[activeDiff] : null;


  const trend: { day: string; solved: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    const key = String(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000));
    let sum = 0;
    for (const r of rows) sum += r.calendar[key] ?? 0;
    trend.push({ day: `${d.getUTCMonth()+1}/${d.getUTCDate()}`, solved: sum });
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
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

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Classrooms" value={data.classrooms.length} />
        <StatCard label="Students" value={data.students.length} />
        <StatCard label="Active (30d)" value={activeStudents} hint={`${Math.round(activeStudents / Math.max(1, data.students.length) * 100)}% of cohort`} />
        {/* Same naming fix as the classroom header: these count submissions on a
            UTC day, not unique problems solved. */}
        <StatCard label="Solved (total)" value={totals.total.toLocaleString()} hint="unique problems" />
        <StatCard label="Submissions today" value={totals.today} hint="UTC day · at last sync" />
        <StatCard label="Submissions this week" value={totals.week} hint="UTC Mon–today" />
      </div>

      <SectionTitle>Behavioral Buckets</SectionTitle>
      {/*
        These were read-only counters: you could see that 14 students were At Risk
        but had no way to act on it. Selecting one now scopes every stat, chart,
        and leaderboard below to that group.
      */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.filter((b) => b.id !== "all").map((b) => {
          const active = bucket === b.id;
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                // Filter the page and show the roster behind the number. Closing
                // the dialog leaves the filter in place — the banner below is the
                // way out of it.
                setBucket(b.id);
                setRoster(b.id);
              }}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-primary/50",
              )}
            >
              <div
                className={cn(
                  "mb-1 font-mono text-[9px] uppercase tracking-widest",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {b.label}
              </div>
              <div className="font-mono text-2xl font-bold">{buckets[b.id]}</div>
            </button>
          );
        })}
      </div>

      {bucket !== "all" && (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
          <Filter className="size-4 shrink-0 text-primary" />
          <span>
            Filtered to <b className="text-primary">{activeBucket?.label}</b> —{" "}
            <span className="font-mono">{rows.length}</span> of{" "}
            <span className="font-mono">{allRows.length}</span> students. Everything below
            reflects this group.
          </span>
          <button
            onClick={() => setBucket("all")}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            <X className="size-3" /> Clear
          </button>
        </div>
      )}
      {bucket === "all" && <div className="mb-8" />}

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider">30-Day Cohort Activity</h3>
            <Flame className="size-4 text-primary" />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid stroke={cBorder} strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10} stroke={cMutedFg} />
                <YAxis fontSize={10} stroke={cMutedFg} />
                <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12, color: cMutedFg }} />
                <Line
                  type="monotone"
                  dataKey="solved"
                  stroke={cPrimary}
                  strokeWidth={2}
                  dot={false}
                  {...chartMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider">Difficulty Split</h3>
            <Target className="size-4 text-primary" />
          </div>
          <div className="relative h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  {...chartMotion}
                  data={diff}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  strokeWidth={0}
                  activeIndex={activeDiff ?? undefined}
                  onMouseEnter={(_, i) => setActiveDiff(i)}
                  onMouseLeave={() => setActiveDiff(null)}
                >
                  {diff.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-bold leading-none text-foreground">{center ? center.value : totalSolved}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {center ? center.name : "Total Solved"}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
            <div><span className="text-easy">■</span> Easy {totals.easy}</div>
            <div><span className="text-medium">■</span> Med {totals.medium}</div>
            <div><span className="text-hard">■</span> Hard {totals.hard}</div>
          </div>
        </div>
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wider">Leaderboard</h3>
            <Trophy className="size-4 shrink-0 text-primary" />
          </div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Hover a row to see the count.</p>
            <TopNControl value={topN} max={rows.length} onChange={setTopN} />
          </div>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <LeaderboardBars entries={ranked} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider">Classroom Leaderboard</h3>
            <Users className="size-4 text-primary" />
          </div>
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
        title={BUCKETS.find((b) => b.id === roster)?.label ?? "Students"}
        students={(roster ? filterBucket(allRows, roster) : []).map((r) => ({
          ...r,
          classroom: classroomOf.get(r.id) ?? null,
        }))}
      />
    </div>
  );
}
