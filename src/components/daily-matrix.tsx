import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMatrixBreakdown } from "@/lib/classrooms.functions";
import { SkeletonTable } from "@/components/skeletons";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

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

type MatrixView = "both" | "total" | "gain";

type Cell = {
  total: number;
  /** Newly solved since this student's previous snapshot. Null on the first one. */
  gain: number | null;
  /** Days that gain covers. >1 when a snapshot was missed. */
  span: number;
};

function daysBetween(a: string, b: string): number {
  const diff = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.max(1, Math.round(diff / 86_400_000));
}

/**
 * A day's movement. `null` means "no earlier snapshot", which is not the same as
 * zero — a flat day is rendered as a dim dash so a wall of "+0" doesn't drown out
 * the days that actually moved.
 */
function GainBadge({
  gain,
  span,
  stacked,
}: {
  gain: number | null;
  span: number;
  stacked: boolean;
}) {
  if (gain === null) {
    return <span className={cn("text-[9px] text-muted-foreground/40", stacked && "mt-0.5")}>·</span>;
  }
  if (gain <= 0) {
    return <span className={cn("text-[9px] text-muted-foreground/40", stacked && "mt-0.5")}>–</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-px font-bold",
        // A gain across a snapshot gap isn't one day's work. Amber marks it so a
        // caught-up backlog can't be misread as a single heroic day.
        span > 1 ? "text-medium" : "text-easy",
        stacked ? "mt-0.5 text-[9px]" : "text-[11px]",
      )}
    >
      <ArrowUp className={stacked ? "size-2.5" : "size-3"} strokeWidth={3} />
      {gain}
      {span > 1 && <span className="ml-px opacity-70">/{span}d</span>}
    </span>
  );
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
  const [view, setView] = useState<MatrixView>("both");

  // `isPending` matters here: with only `breakdown` to go on, the table rendered a
  // full grid of "—" placeholders during every fetch, which looks exactly like a
  // classroom with no snapshot data at all.
  const { data: breakdown, isPending } = useQuery({
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

  /**
   * Per-student `date -> { total, gain }`.
   *
   * `gain` is measured against that student's previous *snapshot*, not the
   * previous column — a student with no data on the 3rd who reappears on the 4th
   * gained across the gap, and pretending otherwise would credit the wrong day.
   * The first snapshot in range has no predecessor, so its gain is null (unknown)
   * rather than 0 (no progress) — those are different statements.
   *
   * This also replaces the per-cell `snapshots.find()` the table used to run,
   * which was a full scan for every student x date pair.
   */
  const byStudent = useMemo(() => {
    const out = new Map<string, Map<string, Cell>>();
    for (const [studentId, v] of Object.entries(breakdown ?? {})) {
      const snaps = [...v.snapshots].sort((a, b) => a.date.localeCompare(b.date));
      const m = new Map<string, Cell>();
      let prev: { total: number; date: string } | null = null;
      for (const s of snaps) {
        m.set(s.date, {
          total: s.total,
          gain: prev === null ? null : s.total - prev.total,
          span: prev === null ? 1 : daysBetween(prev.date, s.date),
        });
        prev = { total: s.total, date: s.date };
      }
      out.set(studentId, m);
    }
    return out;
  }, [breakdown]);

  const cohort = useMemo(
    () =>
      allDates.map((date) =>
        rows.reduce(
          (acc, r) => {
            const cell = byStudent.get(r.id)?.get(date);
            return {
              total: acc.total + (cell?.total ?? 0),
              gain: acc.gain + (cell?.gain ?? 0),
              // Widest span wins: if any student's number covers 3 days, the
              // cohort total for that column does too.
              span: Math.max(acc.span, cell?.gain ? cell.span : 1),
            };
          },
          { total: 0, gain: 0, span: 1 },
        ),
      ),
    [allDates, rows, byStudent],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [allDates.length]);

  function handleExportCsv() {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // Each day exports as a total and a gain column, so the CSV carries the same
    // information the table now shows rather than just the running count.
    const header = [
      "Name", "Roll", "Total", "Easy", "Medium", "Hard",
      ...allDates.flatMap((d) => [fmtShort(d), `${fmtShort(d)} +`]),
    ];
    const lines = rows.map((r) => {
      const b = breakdown?.[r.id];
      const cells = byStudent.get(r.id);
      const perDate = allDates.flatMap((d) => {
        const cell = cells?.get(d);
        return [cell?.total ?? "", cell?.gain ?? ""];
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
        {/*
          The grid used to show only the running total, which answers "how many
          have they solved" but not "did they do anything that day" — the question
          a daily matrix exists to answer.
        */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Cell display">
            {(
              [
                ["both", "Both"],
                ["total", "Total"],
                ["gain", "Daily gain"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={
                  view === id
                    ? "rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                    : "rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExportCsv}
            className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
          >
            Export CSV
          </button>
        </div>
      </div>

      {isPending ? (
        <SkeletonTable rows={Math.min(Math.max(rows.length, 4), 10)} columns={8} />
      ) : (
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
                  const cell = byStudent.get(r.id)?.get(date);
                  return (
                    <td
                      key={date}
                      className="border-b border-border/50 px-2 py-1.5 text-center tabular-nums"
                      title={
                        cell
                          ? `${r.name} · ${fmtShort(date)} · ${cell.total} solved` +
                            (cell.gain === null
                              ? " (no earlier snapshot to compare)"
                              : cell.gain > 0
                                ? ` · +${cell.gain} that day`
                                : " · no change that day")
                          : `${r.name} · ${fmtShort(date)} · no data`
                      }
                    >
                      {!cell ? (
                        <span className="text-[11px] font-bold text-foreground">—</span>
                      ) : (
                        <div className="flex flex-col items-center leading-none">
                          {view !== "gain" && (
                            <span className="text-[11px] font-bold text-foreground">
                              {cell.total}
                            </span>
                          )}
                          {view !== "total" && (
                            <GainBadge gain={cell.gain} span={cell.span} stacked={view === "both"} />
                          )}
                        </div>
                      )}
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
              {cohort.map((c, i) => (
                <td
                  key={i}
                  className="border-t border-border px-2 py-1.5 text-center tabular-nums"
                  title={`Cohort · ${fmtShort(allDates[i])} · ${c.total} solved · +${c.gain} that day`}
                >
                  <div className="flex flex-col items-center leading-none">
                    {view !== "gain" && (
                      <span className="text-[11px] font-bold text-primary">{c.total || "·"}</span>
                    )}
                    {view !== "total" && <GainBadge gain={c.gain} span={c.span} stacked={view === "both"} />}
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      </div>
      )}
    </div>
  );
}
