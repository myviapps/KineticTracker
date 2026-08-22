import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

import { buildReport, listReportScopes } from "@/lib/reports.functions";
import { downloadReportWorkbook, type ReportData } from "@/lib/report-workbook";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Export dialog.
 *
 * Opens pre-ticked with whatever you launched it from, then lists every other
 * classroom you may access so one cohort can become a multi-cohort report
 * without leaving the page. The list comes from `listReportScopes`, which is
 * scoped by `accessibleClassroomIds` — a faculty member never sees, and cannot
 * request, a cohort they are not assigned to.
 */
export function ReportExportDialog({
  open,
  onOpenChange,
  preselectClassroomIds = [],
  preselectCollegeIds = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preselectClassroomIds?: string[];
  preselectCollegeIds?: string[];
}) {
  const scopes = useQuery({
    queryKey: ["report-scopes"],
    queryFn: () => listReportScopes(),
    enabled: open,
    staleTime: 60_000,
  });

  const [picked, setPicked] = useState<Set<string>>(new Set(preselectClassroomIds));
  const [days, setDays] = useState(30);
  /*
    The date the Streaks sheet is measured against — the same "X" the Streak
    Matrix on the cohort page asks about. Defaults to today. Exposed here so a
    workbook can answer the question someone was looking at on screen, rather
    than always answering it for today and quietly disagreeing.
  */
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [touched, setTouched] = useState(false);

  // Seed from the launching page the first time the list arrives, then leave the
  // user's choices alone.
  const initial = useMemo(() => {
    if (touched || !scopes.data) return null;
    if (preselectClassroomIds.length) return new Set(preselectClassroomIds);
    if (preselectCollegeIds.length) {
      return new Set(
        scopes.data.classrooms
          .filter((c) => c.college_id && preselectCollegeIds.includes(c.college_id))
          .map((c) => c.id),
      );
    }
    return null;
  }, [scopes.data, preselectClassroomIds, preselectCollegeIds, touched]);

  const selected = initial ?? picked;

  const toggle = (id: string) => {
    setTouched(true);
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const build = useServerFn(buildReport);
  const run = useMutation({
    mutationFn: async (mode: "workbook" | "print") => {
      const data = (await build({
        data: { classroomIds: [...selected], days, asOf },
      })) as unknown as ReportData;
      return { data, mode };
    },
    onSuccess: ({ data, mode }) => {
      if (data.totals.students === 0) {
        toast.error("Nothing to export — no students in the selected cohorts.");
        return;
      }
      if (mode === "workbook") {
        const name = downloadReportWorkbook(data);
        toast.success(`Downloaded ${name}`, {
          description: `${data.totals.students} students · ${data.fact.length} platform rows · ${data.daily.length} daily rows · ${data.streaks?.length ?? 0} streak rows`,
        });
      } else {
        sessionStorage.setItem("almanac-report", JSON.stringify(data));
        window.open("/reports?from=session", "_blank");
      }
      onOpenChange(false);
    },
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });

  const byCollege = useMemo(() => {
    const map = new Map<string, { name: string; rooms: { id: string; name: string }[] }>();
    for (const c of scopes.data?.classrooms ?? []) {
      const college = scopes.data?.colleges.find((x) => x.id === c.college_id);
      const key = college?.id ?? "none";
      const entry = map.get(key) ?? { name: college?.name ?? "Unassigned", rooms: [] };
      entry.rooms.push({ id: c.id, name: c.name });
      map.set(key, entry);
    }
    return [...map.values()];
  }, [scopes.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" /> Export report
          </DialogTitle>
          <DialogDescription>
            Pick the cohorts to include. The workbook has a Summary, a Roster, a flat Fact sheet for
            PivotTables or Power BI, and daily history.
          </DialogDescription>
        </DialogHeader>

        {scopes.isPending && (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading cohorts…</div>
        )}

        {scopes.data && (
          <div className="max-h-72 space-y-3 overflow-auto pr-1">
            {byCollege.map((group) => (
              <div key={group.name}>
                <div className="mb-1 font-mono text-3xs uppercase tracking-widest text-muted-foreground">
                  {group.name}
                </div>
                <div className="space-y-1.5">
                  {group.rooms.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
                    >
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                      <span className="text-sm">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {byCollege.length === 0 && (
              <p className="text-sm text-muted-foreground">No cohorts are available to you.</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Label htmlFor="days" className="text-xs">
            Daily history
          </Label>
          <select
            id="days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value={0}>None</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>

          <Label htmlFor="asof" className="ml-3 text-xs">
            Streaks as of
          </Label>
          <input
            id="asof"
            type="date"
            value={asOf}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
          />

          <span className="ml-auto font-mono text-3xs text-muted-foreground">
            {selected.size} cohort{selected.size === 1 ? "" : "s"} selected
          </span>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={selected.size === 0 || run.isPending}
            onClick={() => run.mutate("print")}
          >
            Open print view
          </Button>
          <Button
            disabled={selected.size === 0 || run.isPending}
            onClick={() => run.mutate("workbook")}
          >
            {run.isPending ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Download className="mr-1 size-3" />
            )}
            Download workbook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
