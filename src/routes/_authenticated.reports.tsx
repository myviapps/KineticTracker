import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Printer, Loader2 } from "lucide-react";

import { buildReport, listReportScopes } from "@/lib/reports.functions";
import { downloadReportWorkbook, type ReportData } from "@/lib/report-workbook";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION } from "@/lib/chart-motion";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Almanac" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const scopes = useQuery({ queryKey: ["report-scopes"], queryFn: () => listReportScopes() });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  // Same anchor the export dialog and the cohort Streak Matrix use, so all
  // three answer "what streak did they have on X" for the same X.
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ReportData | null>(null);

  /*
    A report opened from the export dialog arrives via sessionStorage rather than
    the URL: the payload is tens of thousands of rows and would not survive a
    query string. The dialog has already paid for the fetch, so re-running it
    here would double the work for no benefit.
  */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("from") !== "session") return;
    const raw = sessionStorage.getItem("almanac-report");
    if (raw) {
      try {
        setReport(JSON.parse(raw) as ReportData);
      } catch {
        /* a corrupt payload just means the picker below is used instead */
      }
    }
  }, []);

  const build = useServerFn(buildReport);
  const run = useMutation({
    mutationFn: () => build({ data: { classroomIds: [...selected], days, asOf } }),
    onSuccess: (d) => {
      const data = d as unknown as ReportData;
      setReport(data);
      if (data.totals.students === 0) toast.error("No students in the selected cohorts.");
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  /** Select or clear a whole college in one action. */
  const toggleMany = (ids: string[], select: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (select) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  /** Cohorts grouped under their college, both already in the scopes payload. */
  const collegeGroups = useMemo(() => {
    const rooms = scopes.data?.classrooms ?? [];
    const names = new Map((scopes.data?.colleges ?? []).map((c) => [c.id, c.name]));
    const by = new Map<string, { id: string; name: string; rooms: typeof rooms }>();
    for (const r of rooms) {
      const key = r.college_id ?? "__none";
      const g = by.get(key) ?? {
        id: key,
        name: r.college_id ? (names.get(r.college_id) ?? "Unknown college") : "No college",
        rooms: [] as typeof rooms,
      };
      g.rooms.push(r);
      by.set(key, g);
    }
    return [...by.values()]
      .map((g) => ({ ...g, rooms: [...g.rooms].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopes.data]);

  return (
    <div className="p-6 lg:p-8">
      {/* The picker is chrome, not content — it must not appear in the PDF. */}
      <div className="print:hidden">
        <SectionTitle>Reports</SectionTitle>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Build a report across any cohorts you can access, then download the workbook or print this
          page to PDF.
        </p>

        <div className="mb-5 rounded-lg border border-border bg-surface p-4">
          {scopes.isPending && <p className="text-sm text-muted-foreground">Loading cohorts…</p>}
          {/*
            Grouped by college, with a select-all per group.

            listReportScopes already returned a colleges array AND a college_id
            on every classroom; this page threw both away and rendered one flat
            grid, so building "a report for CMRTC" meant ticking its cohorts by
            hand and knowing which ones they were. Purely client-side.
          */}
          {collegeGroups.map((g) => {
            const ids = g.rooms.map((r) => r.id);
            const allOn = ids.every((id) => selected.has(id));
            return (
              <div key={g.id} className="mb-3 last:mb-0">
                {collegeGroups.length > 1 && (
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-3xs font-bold uppercase tracking-widest text-muted-foreground">
                      {g.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleMany(ids, !allOn)}
                      className="text-2xs font-medium text-primary hover:underline"
                    >
                      {allOn ? "Clear" : "Select all"}
                    </button>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.rooms.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
                    >
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      <span className="truncate text-sm">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <select
              aria-label="Report window in days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <option value={0}>No daily history</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Streaks as of
              <input
                type="date"
                value={asOf}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && setAsOf(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              />
            </label>
            <Button
              size="sm"
              disabled={selected.size === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
              Build report
            </Button>
            {report && (
              <>
                <Button size="sm" variant="outline" onClick={() => downloadReportWorkbook(report)}>
                  <Download className="mr-1 size-3" /> Workbook
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1 size-3" /> Print / PDF
                </Button>
              </>
            )}
            <span className="ml-auto font-mono text-3xs text-muted-foreground">
              {selected.size} selected
            </span>
          </div>
        </div>
      </div>

      {report && report.totals.students > 0 && <ReportDashboard data={report} />}
    </div>
  );
}

function ReportDashboard({ data }: { data: ReportData }) {
  const [cPrimary, cBorder, cSurface, cMutedFg] = useCssVars(
    "--primary",
    "--border",
    "--surface",
    "--muted-foreground",
  );

  const chart = useMemo(
    () =>
      data.summaryPlatforms.map((p) => ({
        name: p.platform_name,
        students: p.students,
        solved: p.total_solved,
      })),
    [data.summaryPlatforms],
  );

  return (
    <div className="space-y-6">
      <div className="report-block">
        <h1 className="text-xl font-bold">
          {data.scope.colleges.map((c) => c.name).join(", ") || "Report"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.scope.classrooms.map((c) => c.name).join(" · ")}
        </p>
        <p className="font-mono text-3xs text-muted-foreground">
          Generated {new Date(data.scope.generatedAt).toLocaleString()}
        </p>
      </div>

      <div className="report-block grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Students" value={data.totals.students.toLocaleString()} />
        <StatCard label="Classrooms" value={data.totals.classrooms} />
        <StatCard label="Colleges" value={data.totals.colleges} />
        <StatCard label="Avg Almanac Score" value={data.totals.avgScore.toLocaleString()} />
        <StatCard
          label="Problems Solved"
          value={data.totals.totalSolved.toLocaleString()}
          hint="raw sum across platforms"
        />
      </div>

      <div className="report-block rounded-lg border border-border bg-surface p-5">
        <SectionTitle>Problems Solved by Platform</SectionTitle>
        <div className="mt-3 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cBorder} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: cMutedFg }} />
              <YAxis tick={{ fontSize: 10, fill: cMutedFg }} />
              <Tooltip
                contentStyle={{
                  background: cSurface,
                  border: `1px solid ${cBorder}`,
                  fontSize: 12,
                }}
              />
              <Bar {...CHART_MOTION} dataKey="solved" radius={[3, 3, 0, 0]}>
                {chart.map((c) => (
                  <Cell key={c.name} fill={cPrimary} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="report-block overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2">
          <SectionTitle>Performance by Platform</SectionTitle>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">
                Platform
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Students
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Coverage
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Avg
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Solved
              </th>
              <th scope="col" className="px-3 py-2">
                Top
              </th>
            </tr>
          </thead>
          <tbody>
            {data.summaryPlatforms.map((p) => (
              <tr key={p.platform_name} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-medium">{p.platform_name}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{p.students}</td>
                <td className="px-3 py-2 text-right">{p.coverage_pct}%</td>
                <td className="px-3 py-2 text-right font-bold">
                  {p.avg_metric?.toLocaleString() ?? "—"}
                  <span className="ml-1 font-mono text-3xs font-normal text-muted-foreground">
                    {p.rank_metric}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {p.total_solved.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.top_student ?? "—"}
                  {p.top_value != null && (
                    <span className="ml-1 font-mono text-3xs text-muted-foreground">
                      {p.top_value.toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.streaks?.length > 0 && <StreakSection rows={data.streaks} />}

      <div className="report-block overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2">
          <SectionTitle>Top 25 by Almanac Score</SectionTitle>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">
                #
              </th>
              <th scope="col" className="px-3 py-2">
                Student
              </th>
              <th scope="col" className="px-3 py-2">
                Roll
              </th>
              <th scope="col" className="px-3 py-2">
                Classrooms
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Score
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                College Rank
              </th>
            </tr>
          </thead>
          <tbody>
            {[...data.roster]
              .sort((a, b) => Number(b["Almanac Score"] ?? 0) - Number(a["Almanac Score"] ?? 0))
              .slice(0, 25)
              .map((r, i) => (
                <tr key={String(r.Roll)} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">{r.Student}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.Roll}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.Classrooms}</td>
                  <td className="px-3 py-2 text-right font-bold">
                    {Number(r["Almanac Score"] ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">{r["College Rank"] ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Consistency, on screen and on the printed sheet.
 *
 * Reads the same rows the Streaks sheet of the workbook carries, so the PDF a
 * principal is handed and the file an analyst opens report identical numbers.
 *
 * `Streak Through` can be null — a student with no submission calendar has not
 * been measured, which is not the same as a streak of zero, and the count of
 * those is stated rather than folded into the totals.
 */
function StreakSection({ rows }: { rows: ReportData["streaks"] }) {
  const measured = rows.filter((r) => typeof r["Streak Through"] === "number");
  const through = measured.map((r) => Number(r["Streak Through"]));
  const onStreak = through.filter((v) => v >= 7).length;
  const longest = through.length ? Math.max(...through) : 0;
  const asOf = String(rows[0]?.["As Of"] ?? "");
  const activeKey = Object.keys(rows[0] ?? {}).find((k) => k.startsWith("Active Days In"));
  const longestKey = Object.keys(rows[0] ?? {}).find((k) => k.startsWith("Longest In"));

  const top = [...measured]
    .sort((a, b) => Number(b["Streak Through"] ?? 0) - Number(a["Streak Through"] ?? 0))
    .slice(0, 25);

  return (
    <div className="report-block space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="On a 7+ day streak"
          value={onStreak.toLocaleString()}
          hint={`of ${measured.length} measured`}
        />
        <StatCard label="Longest active streak" value={longest ? `${longest}d` : "—"} />
        <StatCard label="Measured as of" value={<span className="text-xl">{asOf}</span>} />
        <StatCard
          label="No streak record"
          value={(rows.length - measured.length).toLocaleString()}
          hint="LeetCode calendar missing"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2">
          <SectionTitle>Longest Current Streaks</SectionTitle>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">
                Student
              </th>
              <th scope="col" className="px-3 py-2">
                Roll
              </th>
              <th scope="col" className="px-3 py-2 text-right" title={`Run carried into ${asOf}`}>
                Into
              </th>
              <th scope="col" className="px-3 py-2 text-right" title={`Run including ${asOf}`}>
                Through
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Best
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Active
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={String(r.Roll)} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2">{r.Student}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.Roll}</td>
                <td className="px-3 py-2 text-right font-mono">{r["Streak Into"] ?? "—"}d</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-primary">
                  {r["Streak Through"] ?? "—"}d
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {longestKey ? (r[longestKey] ?? "—") : "—"}d
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {activeKey ? (r[activeKey] ?? "—") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
