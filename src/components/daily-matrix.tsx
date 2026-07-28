import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getMatrixBreakdown } from "@/lib/classrooms.functions";

type Row = {
  id: string;
  name: string;
  roll: string;
};

function fmtShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function fmtWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
}

export function DailyMatrix({
  classroomId,
  rows,
  startDate,
}: {
  classroomId: string;
  rows: Row[];
  startDate: Date;
}) {
  const [customStart, setCustomStart] = useState<string>(
    startDate.toISOString().slice(0, 10)
  );
  const [customEnd, setCustomEnd] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  const { data: breakdown } = useQuery({
    queryKey: ["matrix-breakdown", classroomId, customStart, customEnd],
    queryFn: () => getMatrixBreakdown({ data: { classroomId, startDate: customStart, endDate: customEnd } }),
  });

  const allDates = useMemo(() => {
    if (!breakdown) return [];
    const set = new Set<string>();
    for (const v of Object.values(breakdown)) {
      for (const s of v.snapshots) set.add(s.date);
    }
    return [...set].sort();
  }, [breakdown]);

  const cohortTotals = useMemo(() => {
    return allDates.map((date) =>
      rows.reduce((sum, r) => {
        const b = breakdown?.[r.id];
        const snap = b?.snapshots.find((s) => s.date === date);
        return sum + (snap?.total ?? 0);
      }, 0)
    );
  }, [allDates, rows, breakdown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [allDates.length]);

  function handleExportCsv() {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Name", "Roll", "Total", "Easy", "Medium", "Hard", ...allDates.map((d) => fmtShort(d))];
    const lines = rows.map((r) => {
      const b = breakdown?.[r.id];
      const perDate = allDates.map((d) => {
        const snap = b?.snapshots.find((s) => s.date === d);
        return snap?.total ?? 0;
      });
      return [r.name, r.roll, b?.latest?.total ?? 0, b?.latest?.easy ?? 0, b?.latest?.medium ?? 0, b?.latest?.hard ?? 0, ...perDate]
        .map(escape).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matrix_${customStart}_${customEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={customEnd}
            min={customStart}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleExportCsv}
          className="ml-auto h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
        >
          Export CSV
        </button>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-lg border border-border bg-surface"
      >
        <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 z-20 min-w-[200px] border-b border-r border-border bg-background/95 px-3 py-2 text-left backdrop-blur">
              Student
            </th>
            <th className="sticky left-[200px] z-20 min-w-[60px] border-b border-r border-border bg-background/95 px-3 py-2 text-right backdrop-blur">
              Σ Total
            </th>
            <th className="sticky left-[260px] z-20 min-w-[50px] border-b border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-easy">
              E
            </th>
            <th className="sticky left-[310px] z-20 min-w-[50px] border-b border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-medium">
              M
            </th>
            <th className="sticky left-[360px] z-20 min-w-[50px] border-b border-r border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-hard">
              H
            </th>
            {allDates.map((date) => (
              <th
                key={date}
                className="border-b border-border px-2 py-1 text-center align-bottom"
              >
                <div className="text-[10px] font-bold leading-tight">{fmtShort(date)}</div>
                <div className="text-[8px] opacity-60">{fmtWeekday(date)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={allDates.length + 5}
                className="px-4 py-16 text-center text-muted-foreground"
              >
                No students in this bucket.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => {
            const b = breakdown?.[r.id];
            const latest = b?.latest;
            return (
              <tr key={r.id} className="group">
                <td className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 group-hover:bg-primary/5">
                  <Link
                    to="/students/$roll"
                    params={{ roll: r.roll }}
                    className="block"
                  >
                    <div className="font-sans text-xs font-semibold hover:text-primary">
                      {r.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{r.roll}</div>
                  </Link>
                </td>
                <td className="sticky left-[200px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right font-bold group-hover:bg-primary/5">
                  {latest?.total ?? <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="sticky left-[260px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-easy group-hover:bg-primary/5">
                  {latest?.easy ?? <span className="opacity-50">—</span>}
                </td>
                <td className="sticky left-[310px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-medium group-hover:bg-primary/5">
                  {latest?.medium ?? <span className="opacity-50">—</span>}
                </td>
                <td className="sticky left-[360px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right font-bold text-hard group-hover:bg-primary/5">
                  {latest?.hard ?? <span className="opacity-50">—</span>}
                </td>
                {allDates.map((date) => {
                  const snap = b?.snapshots.find((s) => s.date === date);
                  const v = snap?.total;
                  return (
                    <td
                      key={date}
                      className="border-b border-border/50 px-2 py-2 text-center text-[11px] font-bold tabular-nums text-foreground"
                      title={`${r.name} · ${fmtShort(date)} · ${v ?? "no data"}`}
                    >
                      {v ?? "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-background/80 font-mono text-[10px] uppercase tracking-wider">
              <td className="sticky left-0 z-10 border-t border-r border-border bg-background/95 px-3 py-2 font-bold">
                Cohort / day
              </td>
              <td className="sticky left-[200px] z-10 border-t border-r border-border bg-background/95 px-3 py-2 text-right font-bold text-primary">
                {rows.reduce((s, r) => s + ((breakdown?.[r.id]?.latest?.total) ?? 0), 0)}
              </td>
              <td className="sticky left-[260px] z-10 border-t border-border bg-background/95 px-3 py-2 text-right font-bold text-easy">
                {rows.reduce((s, r) => s + ((breakdown?.[r.id]?.latest?.easy) ?? 0), 0) || "—"}
              </td>
              <td className="sticky left-[310px] z-10 border-t border-border bg-background/95 px-3 py-2 text-right font-bold text-medium">
                {rows.reduce((s, r) => s + ((breakdown?.[r.id]?.latest?.medium) ?? 0), 0) || "—"}
              </td>
              <td className="sticky left-[360px] z-10 border-t border-r border-border bg-background/95 px-3 py-2 text-right font-bold text-hard">
                {rows.reduce((s, r) => s + ((breakdown?.[r.id]?.latest?.hard) ?? 0), 0) || "—"}
              </td>
              {cohortTotals.map((t, i) => (
                <td
                  key={i}
                  className="border-t border-border px-2 py-2 text-center text-[11px] font-bold text-primary"
                >
                  {t || "·"}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      </div>
    </div>
  );
}
