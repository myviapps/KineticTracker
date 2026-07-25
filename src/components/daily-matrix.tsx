import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getMatrixBreakdown } from "@/lib/classrooms.functions";

type Row = {
  id: string;
  name: string;
  roll: string;
  calendar: Record<string, number>;
};

// UTC day-key (unix seconds at 00:00 UTC) matches LeetCode's submissionCalendar keys.
function dayKey(d: Date): string {
  return String(
    Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000),
  );
}

function fmtShort(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function fmtWeekday(d: Date): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
}

function intensity(n: number): string {
  if (n <= 0) return "bg-transparent text-muted-foreground/40";
  if (n === 1) return "bg-primary/15 text-primary";
  if (n <= 3) return "bg-primary/35 text-primary-foreground";
  if (n <= 6) return "bg-primary/60 text-primary-foreground";
  return "bg-primary text-primary-foreground";
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

  // Build day list from customStart (inclusive) to customEnd (inclusive), UTC.
  const days = useMemo(() => {
    const out: { date: Date; key: string; label: string; wd: string; n: number }[] = [];
    
    // Parse strings back to UTC dates to avoid timezone shifts
    const [sy, sm, sd] = customStart.split("-").map(Number);
    const start = new Date(Date.UTC(sy, sm - 1, sd));
    
    const [ey, em, ed] = customEnd.split("-").map(Number);
    const end = new Date(Date.UTC(ey, em - 1, ed));
    
    let n = 1;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = new Date(d);
      out.push({ date: day, key: dayKey(day), label: fmtShort(day), wd: fmtWeekday(day), n: n++ });
    }
    return out;
  }, [customStart, customEnd]);

  const dailyTotals = useMemo(() => {
    return days.map((d) => rows.reduce((s, r) => s + (r.calendar[d.key] ?? 0), 0));
  }, [days, rows]);

  const rowTotals = useMemo(() => {
    return rows.map((r) => days.reduce((s, d) => s + (r.calendar[d.key] ?? 0), 0));
  }, [days, rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Auto-scroll to today on mount / when new days append.
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [days.length]);

  const { data: breakdown } = useQuery({
    queryKey: ["matrix-breakdown", classroomId, customStart, customEnd],
    queryFn: () => getMatrixBreakdown({ data: { classroomId, startDate: customStart, endDate: customEnd } }),
  });

  const todayKey = dayKey(new Date());

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
            <th className="sticky left-[200px] z-20 min-w-[70px] border-b border-r border-border bg-background/95 px-3 py-2 text-right backdrop-blur">
              Σ Days
            </th>
            <th className="sticky left-[270px] z-20 min-w-[50px] border-b border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-easy">
              E
            </th>
            <th className="sticky left-[320px] z-20 min-w-[50px] border-b border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-medium">
              M
            </th>
            <th className="sticky left-[370px] z-20 min-w-[50px] border-b border-r border-border bg-background/95 px-3 py-2 text-right backdrop-blur text-hard">
              H
            </th>
            {days.map((d) => (
              <th
                key={d.key}
                className={cn(
                  "border-b border-border px-2 py-1 text-center align-bottom",
                  d.key === todayKey && "bg-primary/10 text-primary",
                )}
              >
                <div className="text-[9px] leading-tight">Day {d.n}</div>
                <div className="text-[10px] font-bold leading-tight">{d.label}</div>
                <div className="text-[8px] opacity-60">{d.wd}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={days.length + 5}
                className="px-4 py-16 text-center text-muted-foreground"
              >
                No students in this bucket.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
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
                {rowTotals[ri] || <span className="text-muted-foreground/50">0</span>}
              </td>
              <td className="sticky left-[270px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-easy group-hover:bg-primary/5">
                {breakdown?.[r.id]?.easy || <span className="opacity-50">-</span>}
              </td>
              <td className="sticky left-[320px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-medium group-hover:bg-primary/5">
                {breakdown?.[r.id]?.medium || <span className="opacity-50">-</span>}
              </td>
              <td className="sticky left-[370px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right font-bold text-hard group-hover:bg-primary/5">
                {breakdown?.[r.id]?.hard || <span className="opacity-50">-</span>}
              </td>
              {days.map((d) => {
                const v = r.calendar[d.key] ?? 0;
                return (
                  <td
                    key={d.key}
                    className={cn(
                      "border-b border-border/50 px-2 py-2 text-center text-[11px] font-bold",
                      intensity(v),
                      d.key === todayKey && "ring-1 ring-inset ring-primary",
                    )}
                    title={`${r.name} · ${d.label} · ${v} solved`}
                  >
                    {v || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-background/80 font-mono text-[10px] uppercase tracking-wider">
              <td className="sticky left-0 z-10 border-t border-r border-border bg-background/95 px-3 py-2 font-bold">
                Cohort / day
              </td>
              <td className="sticky left-[200px] z-10 border-t border-r border-border bg-background/95 px-3 py-2 text-right font-bold text-primary">
                {dailyTotals.reduce((a, b) => a + b, 0)}
              </td>
              <td className="sticky left-[270px] z-10 border-t border-border bg-background/95 px-3 py-2 text-right font-bold text-easy">
                {Object.values(breakdown || {}).reduce((s, b) => s + (b.easy || 0), 0) || "-"}
              </td>
              <td className="sticky left-[320px] z-10 border-t border-border bg-background/95 px-3 py-2 text-right font-bold text-medium">
                {Object.values(breakdown || {}).reduce((s, b) => s + (b.medium || 0), 0) || "-"}
              </td>
              <td className="sticky left-[370px] z-10 border-t border-r border-border bg-background/95 px-3 py-2 text-right font-bold text-hard">
                {Object.values(breakdown || {}).reduce((s, b) => s + (b.hard || 0), 0) || "-"}
              </td>
              {dailyTotals.map((t, i) => (
                <td
                  key={i}
                  className={cn(
                    "border-t border-border px-2 py-2 text-center text-[11px] font-bold",
                    t > 0 ? "text-primary" : "text-muted-foreground/40",
                    days[i].key === todayKey && "bg-primary/10",
                  )}
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
