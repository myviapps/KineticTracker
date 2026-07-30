import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, Ban } from "lucide-react";

import {
  listScrapeRuns,
  listFailedStudents,
  retryFailedStudents,
  FAILURE_CUTOFF,
  type FailedStudent,
} from "@/lib/scrape-runs.functions";
import { AnimatedLoader } from "@/components/animated-loader";
import { RefreshButton } from "@/components/refresh-button";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { REFRESH_JOB_KEY } from "@/hooks/use-refresh-job";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_admin/scrape-runs")({
  head: () => ({ meta: [{ title: "Scrape History — Almanac" }] }),
  component: ScrapeRunsPage,
  pendingComponent: () => <AnimatedLoader text="Loading scrape history…" />,
});

function fmtDuration(start: string, end: string | null): string {
  if (!end) return "Running…";
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function ScrapeRunsPage() {
  const qc = useQueryClient();
  const retry = useServerFn(retryFailedStudents);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // `isPending`, not the `= []` default: this table showed "No scrape runs recorded
  // yet" on the first load, which is a different statement than "loading".
  const { data: runs = [], isPending } = useQuery({
    queryKey: ["scrape-runs"],
    queryFn: () => listScrapeRuns(),
    refetchInterval: 10_000,
  });

  const { data: failed = [], isPending: failedPending } = useQuery({
    queryKey: ["failed-students"],
    queryFn: () => listFailedStudents(),
    refetchInterval: 15_000,
  });

  const retryM = useMutation({
    mutationFn: (studentIds?: string[]) => retry({ data: { studentIds } }),
    onSuccess: async (res) => {
      setSelected(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY }),
        qc.invalidateQueries({ queryKey: ["failed-students"] }),
      ]);
      toast.success(
        res.queued === 0 ? "Nothing to retry" : `Queued ${res.queued} student${res.queued === 1 ? "" : "s"}`,
      );
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const abandoned = failed.filter((s) => s.abandoned).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
            Almanac / Admin
          </h1>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Scrape History</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every cron, platform-wide, classroom, and per-student refresh.
          </p>
        </div>
        {/* Queue work from the page where you find out it's needed. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => retryM.mutate(undefined)}
            disabled={retryM.isPending || failed.length === 0}
          >
            <RotateCcw className={cn("mr-1 size-4", retryM.isPending && "animate-spin")} />
            Retry all failed{failed.length > 0 && ` (${failed.length})`}
          </Button>
          <RefreshButton scope="platform" />
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList className="mb-4">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="failures">
            Failed students
            {failed.length > 0 && (
              <span className="ml-1.5 rounded bg-hard/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-hard">
                {failed.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          {isPending ? (
            <AnimatedLoader text="Loading runs…" />
          ) : (
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
                  {runs.map((r) => (
                    <tr key={r.id} className="group hover:bg-primary/5">
                      <td className="px-4 py-3 text-xs">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">
                          {(r.source === "cron" || r.source === "platform") && (
                            <RefreshCw className="size-3" />
                          )}
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
                      <td className="px-4 py-3 text-right font-bold">{r.total_students}</td>
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
          )}
        </TabsContent>

        <TabsContent value="failures">
          {abandoned > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-hard/30 bg-hard/5 p-3 text-sm">
              <Ban className="mt-0.5 size-4 shrink-0 text-hard" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {abandoned} student{abandoned === 1 ? " is" : "s are"} being skipped entirely.
                </span>{" "}
                After {FAILURE_CUTOFF} consecutive failures the worker stops attempting a student.
                Retrying resets that counter so they are picked up again.
              </p>
            </div>
          )}

          {selected.size > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
              <span className="text-sm">{selected.size} selected</span>
              <Button
                size="sm"
                onClick={() => retryM.mutate([...selected])}
                disabled={retryM.isPending}
              >
                <RotateCcw className={cn("mr-1 size-3.5", retryM.isPending && "animate-spin")} />
                Retry selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {failedPending ? (
            <AnimatedLoader text="Checking for failures…" />
          ) : failed.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 size-8 text-easy" />
              <p className="text-sm font-medium">No students are failing.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every profile scraped cleanly on its last attempt.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all failing students"
                        checked={selected.size === failed.length && failed.length > 0}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(failed.map((s) => s.id)) : new Set())
                        }
                        className="size-3.5 accent-[var(--primary)]"
                      />
                    </th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Classroom</th>
                    <th className="px-4 py-3">LeetCode ID</th>
                    <th className="px-4 py-3 text-right">Fails</th>
                    <th className="px-4 py-3">Last attempt</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {failed.map((s) => (
                    <FailedRow
                      key={s.id}
                      student={s}
                      checked={selected.has(s.id)}
                      onToggle={() => toggle(s.id)}
                      onRetry={() => retryM.mutate([s.id])}
                      retrying={retryM.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FailedRow({
  student: s,
  checked,
  onToggle,
  onRetry,
  retrying,
}: {
  student: FailedStudent;
  checked: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <tr className={cn("hover:bg-primary/5", s.abandoned && "bg-hard/[0.04]")}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${s.name}`}
          checked={checked}
          onChange={onToggle}
          className="size-3.5 accent-[var(--primary)]"
        />
      </td>
      <td className="px-4 py-3">
        <Link
          to="/students/$roll"
          params={{ roll: s.roll }}
          className="font-medium hover:text-primary hover:underline"
        >
          {s.name}
        </Link>
        <div className="font-mono text-[11px] text-muted-foreground">{s.roll}</div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{s.classroom_name ?? "—"}</td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.leetcode_id}</td>
      <td className="px-4 py-3 text-right">
        <span
          className={cn(
            "font-mono text-xs font-bold",
            s.abandoned ? "text-hard" : "text-medium",
          )}
        >
          {s.consecutive_failures}
        </span>
        {s.abandoned && (
          <span className="ml-1.5 rounded bg-hard/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-hard">
            Skipped
          </span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {s.last_scraped_at ? new Date(s.last_scraped_at).toLocaleString() : "Never"}
      </td>
      <td className="max-w-[360px] px-4 py-3 text-xs text-muted-foreground">
        <span title={s.scrape_error ?? undefined} className="line-clamp-2">
          {s.scrape_error ?? "—"}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" variant="ghost" onClick={onRetry} disabled={retrying}>
          <RotateCcw className="size-3.5" />
          <span className="sr-only">Retry {s.name}</span>
        </Button>
      </td>
    </tr>
  );
}
