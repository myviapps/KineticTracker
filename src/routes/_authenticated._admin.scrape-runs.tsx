import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import { listScrapeRuns } from "@/lib/scrape-runs.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/_admin/scrape-runs")({
  head: () => ({ meta: [{ title: "Scrape History — Kinetic" }] }),
  component: ScrapeRunsPage,
});

function ScrapeRunsPage() {
  const { data: runs = [] } = useQuery({
    queryKey: ["scrape-runs"],
    queryFn: () => listScrapeRuns(),
    refetchInterval: 10_000,
  });

  function fmtDuration(start: string, end: string | null): string {
    if (!end) return "Running…";
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const sec = Math.round((e - s) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6">
        <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
          Kinetic / Admin
        </h1>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Scrape History</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every cron, platform-wide, classroom, and per-student refresh.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Duration</th>
              <th className="px-4 py-3 text-right">Students</th>
              <th className="px-4 py-3 text-right text-easy">OK</th>
              <th className="px-4 py-3 text-right text-hard">Failed</th>
              <th className="px-4 py-3">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  No scrape runs recorded yet.
                </td>
              </tr>
            )}
            {runs.map((r: any) => (
              <tr key={r.id} className="group hover:bg-primary/5">
                <td className="px-4 py-3 text-xs">
                  {new Date(r.started_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">
                    {r.source === "cron" && <RefreshCw className="size-3" />}
                    {r.source === "platform" && <RefreshCw className="size-3" />}
                    {r.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {r.completed_at ? (
                    fmtDuration(r.started_at, r.completed_at)
                  ) : (
                    <span className="inline-flex items-center gap-1 text-medium">
                      <span className="inline-block size-2 animate-pulse rounded-full bg-medium" />
                      Running
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-bold">
                  {r.total_students}
                </td>
                <td className="px-4 py-3 text-right text-easy">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    {r.success_count}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-hard">
                  {r.failed_count > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      {r.failed_count}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">0</span>
                  )}
                </td>
                <td className="max-w-[300px] truncate px-4 py-3 text-xs text-muted-foreground">
                  {r.errors ? JSON.stringify(r.errors).slice(0, 120) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
