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
    mutationFn: () => build({ data: { classroomIds: [...selected], days } }),
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
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(scopes.data?.classrooms ?? []).map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
              >
                <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                <span className="truncate text-sm">{c.name}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <option value={0}>No daily history</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
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
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
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
        <p className="font-mono text-[10px] text-muted-foreground">
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
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Platform</th>
              <th className="px-3 py-2 text-right">Students</th>
              <th className="px-3 py-2 text-right">Coverage</th>
              <th className="px-3 py-2 text-right">Avg</th>
              <th className="px-3 py-2 text-right">Solved</th>
              <th className="px-3 py-2">Top</th>
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
                  <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                    {p.rank_metric}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {p.total_solved.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.top_student ?? "—"}
                  {p.top_value != null && (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {p.top_value.toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="report-block overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2">
          <SectionTitle>Top 25 by Almanac Score</SectionTitle>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Roll</th>
              <th className="px-3 py-2">Classrooms</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">College Rank</th>
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
