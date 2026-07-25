import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { Trophy, Users, Flame, Target, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getOverview } from "@/lib/overview.functions";
import { refreshPlatform } from "@/lib/students.functions";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { toStudentRow, bucketCounts, BUCKETS } from "@/lib/buckets";
import { lastNDaysCount } from "@/lib/date-buckets";
import { cn } from "@/lib/utils";

function useCssVars(...vars: string[]): string[] {
  const resolve = useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    return vars.map((v) => style.getPropertyValue(v).trim() || v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [values, setValues] = useState<string[]>(() =>
    typeof window !== "undefined" ? resolve() : vars,
  );
  useEffect(() => {
    setValues(resolve());
    const observer = new MutationObserver(() => setValues(resolve()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [resolve]);
  return values;
}

const qo = queryOptions({ queryKey: ["overview"], queryFn: () => getOverview() });

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Overview — Kinetic" }] }),
  loader: ({ context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(qo);
    }
  },
  component: OverviewPage,
  pendingComponent: PendingOverview,
});

function PendingOverview() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 space-y-4">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
        <div className="h-4 w-96 rounded bg-muted animate-pulse" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-surface border border-border animate-pulse" />
        ))}
      </div>
      <div className="h-[400px] rounded-lg border border-border bg-surface animate-pulse" />
    </div>
  );
}

function OverviewPage() {
  const router = useRouter();
  const { data } = useSuspenseQuery(qo);
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null);

  const refreshP = useServerFn(refreshPlatform);
  const refreshM = useMutation({
    mutationFn: (force?: boolean) => {
      setRefreshStartedAt(Date.now());
      return refreshP({ data: { force } });
    },
    onSuccess: (r) => {
      toast.success(`Platform Refreshed ${r.ok} · ${r.failed} failed`);
      setRefreshStartedAt(null);
      router.invalidate();
    },
    onError: (e: any) => {
      let msg = e.message;
      try {
        const parsed = JSON.parse(e.message);
        if (parsed.code === "REFRESH_BUSY") {
          toast.error("Another refresh is currently running.", {
            action: {
              label: "Force Unlock",
              onClick: () => refreshM.mutate(true),
            },
          });
          setRefreshStartedAt(null);
          return;
        }
      } catch {
        // Fallback
      }
      toast.error(msg);
      setRefreshStartedAt(null);
    },
  });

  useEffect(() => {
    if (!refreshM.isPending) return;
    const t = setInterval(() => {
      router.invalidate();
    }, 2000);
    return () => clearInterval(t);
  }, [refreshM.isPending, router]);

  const totalStudents = data.students.length;
  const processedCount = refreshStartedAt
    ? data.students.filter((s) => new Date(s.last_scraped_at ?? 0).getTime() > refreshStartedAt).length
    : 0;

  const statsById = new Map(data.stats.map((s: any) => [s.student_id, s]));

  const rows = data.students.map((st) =>
    toStudentRow({ ...st, stats: statsById.get(st.id) ?? null }),
  );

  const totals = rows.reduce(
    (a, r) => {
      a.total += r.total; a.easy += r.easy; a.medium += r.medium; a.hard += r.hard;
      a.today += r.today; a.week += r.week; a.month += r.month;
      return a;
    },
    { total: 0, easy: 0, medium: 0, hard: 0, today: 0, week: 0, month: 0 },
  );

  const buckets = bucketCounts(rows);
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

  const top10 = [...rows].sort((a, b) => b.total - a.total).slice(0, 10);

  const [cEasy, cMedium, cHard, cSurface, cBorder, cMutedFg, cPrimary] = useCssVars(
    "--easy", "--medium", "--hard", "--surface", "--border", "--muted-foreground", "--primary",
  );

  const diff = [
    { name: "Easy", value: totals.easy, color: cEasy },
    { name: "Medium", value: totals.medium, color: cMedium },
    { name: "Hard", value: totals.hard, color: cHard },
  ];


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
            Kinetic / Overview
          </h1>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Command Center</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cross-classroom stats across {data.classrooms.length} cohorts and{" "}
            {data.students.length} students.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Are you sure you want to scrape all students across the entire platform? This may take several minutes.")) {
                refreshM.mutate();
              }
            }}
            disabled={refreshM.isPending}
          >
            <RefreshCw className={cn("mr-2 size-4", refreshM.isPending && "animate-spin")} />
            {refreshM.isPending ? `Scraping... (${processedCount}/${totalStudents})` : "Refresh Platform"}
          </Button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Classrooms" value={data.classrooms.length} />
        <StatCard label="Students" value={data.students.length} />
        <StatCard label="Active (30d)" value={activeStudents} hint={`${Math.round(activeStudents / Math.max(1, data.students.length) * 100)}% of cohort`} />
        <StatCard label="Total Solved" value={totals.total.toLocaleString()} />
        <StatCard label="Today" value={totals.today} hint="submissions" />
        <StatCard label="This Week" value={totals.week} hint="submissions" />
      </div>

      <SectionTitle>Behavioral Buckets</SectionTitle>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.filter((b) => b.id !== "all").map((b) => (
          <div key={b.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              {b.label}
            </div>
            <div className="font-mono text-2xl font-bold">{buckets[b.id]}</div>
          </div>
        ))}
      </div>

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
                <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12 }} />
                <Line type="monotone" dataKey="solved" stroke={cPrimary} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider">Difficulty Split</h3>
            <Target className="size-4 text-primary" />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={diff} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {diff.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
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
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider">Top 10 Students</h3>
            <Trophy className="size-4 text-primary" />
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={top10} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" fontSize={10} stroke={cMutedFg} />
                <YAxis type="category" dataKey="name" fontSize={10} width={110} stroke={cMutedFg} />
                <Tooltip contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12 }} />
                <Bar dataKey="total" fill={cPrimary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
    </div>
  );
}
