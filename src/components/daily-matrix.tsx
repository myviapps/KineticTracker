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

/** Newly solved across the whole filtered date range, split by difficulty. */
type RangeGain = { easy: number; medium: number; hard: number; total: number } | null;

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
    return (
      <span className={cn("text-[9px] text-muted-foreground/40", stacked && "mt-0.5")}>·</span>
    );
  }
  if (gain <= 0) {
    return (
      <span className={cn("text-[9px] text-muted-foreground/40", stacked && "mt-0.5")}>–</span>
    );
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
  platformId,
}: {
  classroomId: string;
  rows: Row[];
  startDate: Date;
  /** Platform whose snapshots the matrix reads. Omitted = the default (leetcode). */
  platformId?: string;
}) {
  // The calendar is clamped to the cohort's lifetime: nothing before the class
  // was onboarded, nothing in the future. Allowing earlier dates made picking
  // one look like "the filter did nothing" — there was never data to show.
  const todayIso = new Date().toISOString().slice(0, 10);
  const minDate = startDate.toISOString().slice(0, 10);
  const [customStart, setCustomStart] = useState<string>(minDate);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);
  const [view, setView] = useState<MatrixView>("both");

  function handleStartChange(value: string) {
    if (!value) return;
    const from = value < minDate ? minDate : value > todayIso ? todayIso : value;
    setCustomStart(from);
    if (from > customEnd) setCustomEnd(from);
  }

  function handleEndChange(value: string) {
    if (!value) return;
    const to = value > todayIso ? todayIso : value < customStart ? customStart : value;
    setCustomEnd(to);
  }

  // `isPending` matters here: with only `breakdown` to go on, the table rendered a
  // full grid of "—" placeholders during every fetch, which looks exactly like a
  // classroom with no snapshot data at all.
  const { data: breakdown, isPending } = useQuery({
    queryKey: ["matrix-breakdown", classroomId, platformId, customStart, customEnd],
    queryFn: () =>
      getMatrixBreakdown({
        data: {
          classroomId,
          startDate: customStart,
          endDate: customEnd,
          ...(platformId ? { platformId } : {}),
        },
      }),
  });

  // One column PER CALENDAR DAY in the selected range, not just the days that
  // happen to have snapshots. The grid previously rendered only snapshot dates,
  // so widening the range added no visible columns — the date filter looked dead.
  const allDates = useMemo(() => {
    if (!customStart || !customEnd || customStart > customEnd) return [];
    /*
      Stepped in UTC, deliberately not with date-fns `eachDayOfInterval`.

      That helper walks in LOCAL time: given a UTC midnight it returns LOCAL
      midnights, and `toISOString()` then pushes each one back across the date
      line for any zone ahead of UTC. In IST (+05:30) a 7 Aug -> 14 Aug filter
      rendered as 6 Aug -> 13 Aug — every column labelled a day early, and every
      snapshot looked up against the wrong key.

      Everything else here is already UTC (fmtShort, fmtWeekday, the snapshot
      dates themselves), so this stays UTC end to end.
    */
    const out: string[] = [];
    const cursor = new Date(`${customStart}T00:00:00Z`);
    const end = new Date(`${customEnd}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }, [customStart, customEnd]);

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

  /**
   * Per-student gain across the WHOLE filtered range (first snapshot in range
   * vs. last), split by difficulty. Distinct from the per-day `Cell.gain` above
   * — this answers "what did they gain over the range I picked", not "what did
   * they gain today". Null (not 0) with fewer than two snapshots: there's no
   * earlier point in range to diff against.
   */
  const rangeGainByStudent = useMemo(() => {
    const out = new Map<string, RangeGain>();
    for (const [studentId, v] of Object.entries(breakdown ?? {})) {
      const snaps = [...v.snapshots].sort((a, b) => a.date.localeCompare(b.date));
      if (snaps.length < 2) {
        out.set(studentId, null);
        continue;
      }
      const first = snaps[0];
      const last = snaps[snaps.length - 1];
      out.set(studentId, {
        easy: last.easy - first.easy,
        medium: last.medium - first.medium,
        hard: last.hard - first.hard,
        total: last.total - first.total,
      });
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
  const lastEndRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || allDates.length === 0) return;
    const last = allDates[allDates.length - 1];
    // Pin to the right edge when the range grew that way (or on first load), so
    // the latest columns greet you. When the range widens LEFT instead — what
    // "show me the old processed data" means — keep the current position and let
    // the newly added history sit to the left, ready to scroll into.
    if (lastEndRef.current === null || last > lastEndRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
    lastEndRef.current = last;
  }, [allDates]);

  function handleExportCsv() {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // Each day exports as a total and a gain column, so the CSV carries the same
    // information the table now shows rather than just the running count.
    const header = [
      "Name",
      "Roll",
      "Total",
      "Easy",
      "Medium",
      "Hard",
      "Range Δ Easy",
      "Range Δ Medium",
      "Range Δ Hard",
      ...allDates.flatMap((d) => [fmtShort(d), `${fmtShort(d)} +`]),
    ];
    const lines = rows.map((r) => {
      const b = breakdown?.[r.id];
      const cells = byStudent.get(r.id);
      const rangeGain = rangeGainByStudent.get(r.id);
      const perDate = allDates.flatMap((d) => {
        const cell = cells?.get(d);
        return [cell?.total ?? "", cell?.gain ?? ""];
      });
      return [
        r.name,
        r.roll,
        b?.latest?.total ?? 0,
        b?.latest?.easy ?? 0,
        b?.latest?.medium ?? 0,
        b?.latest?.hard ?? 0,
        rangeGain?.easy ?? "",
        rangeGain?.medium ?? "",
        rangeGain?.hard ?? "",
        ...perDate,
      ]
        .map(escape)
        .join(",");
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
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">From</label>
          <input
            type="date"
            value={customStart}
            min={minDate}
            max={todayIso}
            onChange={(e) => handleStartChange(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">To</label>
          <input
            type="date"
            value={customEnd}
            min={customStart}
            max={todayIso}
            onChange={(e) => handleEndChange(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {allDates.length} days · {fmtShort(customStart)} → {fmtShort(customEnd)}
        </span>
        <button
          type="button"
          onClick={() => {
            setCustomStart(minDate);
            setCustomEnd(todayIso);
          }}
          className="h-8 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Reset
        </button>
        {/*
          E/M/H are single letters to fit a 50px sticky column — the legend spells
          them out once instead of relying on color alone.
        */}
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-easy" />
            Easy
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-medium" />
            Medium
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-hard" />
            Hard
          </span>
          <span className="opacity-60">· Δ = gain across the selected range</span>
        </div>
        {/*
          The grid used to show only the running total, which answers "how many
          have they solved" but not "did they do anything that day" — the question
          a daily matrix exists to answer.
        */}
        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex rounded-md border border-border p-0.5"
            role="group"
            aria-label="Cell display"
          >
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
          /*
            w-fit so the bordered box hugs the table on a short range instead of
            stretching it; max-w caps the viewport at the sticky block (640px)
            plus ten 56px date columns, so an eleventh scrolls rather than
            squeezing every column past readability.
          */
          className="max-h-[70vh] w-fit max-w-[min(100%,1200px)] overflow-auto rounded-lg border border-border bg-surface"
        >
          {/*
            table-fixed + colgroup, not per-cell min-w.

            The sticky columns pin themselves with hardcoded left-[Npx] offsets,
            which are only correct if each column is EXACTLY the width those
            offsets assume. `min-w` is a floor, not a width — "Σ Total" plus
            px-3 padding rendered wider than its assumed 60px, and a long
            student name wider than 200px, so every offset after the first was
            short and the sticky columns overlapped each other as soon as the
            grid scrolled sideways. Fixed layout makes these widths the single
            source of truth, and w-max stops the table stretching to fill the
            container (which would inflate the columns and break them again).
          */}
          <table className="w-max table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-[224px]" />
              <col className="w-[80px]" />
              <col className="w-[56px]" />
              <col className="w-[56px]" />
              <col className="w-[56px]" />
              <col className="w-[56px]" />
              <col className="w-[56px]" />
              <col className="w-[56px]" />
              {allDates.map((d) => (
                <col key={d} className="w-[56px]" />
              ))}
            </colgroup>
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-border bg-background px-3 py-2 text-left">
                  Student
                </th>
                <th className="sticky left-[224px] top-0 z-30 min-w-[60px] border-b border-r border-border bg-background px-3 py-2 text-right">
                  Σ Total
                </th>
                <th
                  className="sticky left-[304px] top-0 z-30 min-w-[50px] border-b border-border bg-background px-3 py-2 text-right text-easy"
                  title="Easy — cumulative solved to date"
                >
                  E
                </th>
                <th
                  className="sticky left-[360px] top-0 z-30 min-w-[50px] border-b border-border bg-background px-3 py-2 text-right text-medium"
                  title="Medium — cumulative solved to date"
                >
                  M
                </th>
                <th
                  className="sticky left-[416px] top-0 z-30 min-w-[50px] border-b border-border bg-background px-3 py-2 text-right text-hard"
                  title="Hard — cumulative solved to date"
                >
                  H
                </th>
                <th
                  className="sticky left-[472px] top-0 z-30 min-w-[50px] border-b border-border bg-background px-3 py-2 text-right text-easy"
                  title={`Range gain — Easy solved between ${customStart} and ${customEnd}`}
                >
                  ΔE
                </th>
                <th
                  className="sticky left-[528px] top-0 z-30 min-w-[50px] border-b border-border bg-background px-3 py-2 text-right text-medium"
                  title={`Range gain — Medium solved between ${customStart} and ${customEnd}`}
                >
                  ΔM
                </th>
                <th
                  className="sticky left-[584px] top-0 z-30 min-w-[50px] border-b border-r border-border bg-background px-3 py-2 text-right text-hard"
                  title={`Range gain — Hard solved between ${customStart} and ${customEnd}`}
                >
                  ΔH
                </th>
                {allDates.map((date) => (
                  <th
                    key={date}
                    className="sticky top-0 z-20 w-[56px] min-w-[56px] max-w-[56px] bg-background border-b border-border px-2 py-1 text-center align-bottom"
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
                    colSpan={allDates.length + 8}
                    className="px-4 py-16 text-center text-muted-foreground"
                  >
                    No students in this bucket.
                  </td>
                </tr>
              )}
              {/*
                The sticky cells below hover to an OPAQUE colour
                (color-mix of 5% primary into surface), not `bg-primary/5`.

                A translucent background defeats the entire point of a sticky
                column: `bg-primary/5` replaces the opaque `bg-surface` with a
                95%-transparent fill, so on hover the date columns scrolling
                underneath showed straight through and the row rendered as two
                sets of numbers on top of each other. color-mix keeps the exact
                same tint while staying opaque. Do not shorten it back.
              */}
              {rows.map((r) => {
                const b = breakdown?.[r.id];
                const latest = b?.latest;
                const rangeGain = rangeGainByStudent.get(r.id);
                return (
                  <tr key={r.id} className="group">
                    <td className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {/* truncate, because the column is now a FIXED 224px: an
                          unusually long name would otherwise overflow into the
                          next sticky column rather than widening the cell. */}
                      <Link
                        to="/students/$roll"
                        params={{ roll: r.roll }}
                        className="block min-w-0"
                      >
                        <div
                          className="truncate font-sans text-xs font-semibold hover:text-primary"
                          title={r.name}
                        >
                          {r.name}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">{r.roll}</div>
                      </Link>
                    </td>
                    <td className="sticky left-[224px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right font-bold group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {latest?.total ?? <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="sticky left-[304px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-easy group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {latest?.easy ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="sticky left-[360px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-medium group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {latest?.medium ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="sticky left-[416px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-hard group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {latest?.hard ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="sticky left-[472px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-easy group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {rangeGain?.easy ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="sticky left-[528px] z-10 border-b border-border bg-surface px-3 py-2 text-right font-bold text-medium group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {rangeGain?.medium ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="sticky left-[584px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right font-bold text-hard group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      {rangeGain?.hard ?? <span className="opacity-50">—</span>}
                    </td>
                    {allDates.map((date) => {
                      const cell = byStudent.get(r.id)?.get(date);
                      return (
                        <td
                          key={date}
                          className="w-[56px] min-w-[56px] max-w-[56px] border-b border-border/50 px-2 py-1.5 text-center tabular-nums"
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
                                <GainBadge
                                  gain={cell.gain}
                                  span={cell.span}
                                  stacked={view === "both"}
                                />
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
                <tr className="bg-background font-mono text-[10px] uppercase tracking-wider">
                  <td className="sticky left-0 z-10 border-t border-r border-border bg-background px-3 py-2 font-bold">
                    Cohort / day
                  </td>
                  <td className="sticky left-[224px] z-10 border-t border-r border-border bg-background px-3 py-2 text-right font-bold text-primary">
                    {rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.total ?? 0), 0)}
                  </td>
                  <td className="sticky left-[304px] z-10 border-t border-border bg-background px-3 py-2 text-right font-bold text-easy">
                    {rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.easy ?? 0), 0) || "—"}
                  </td>
                  <td className="sticky left-[360px] z-10 border-t border-border bg-background px-3 py-2 text-right font-bold text-medium">
                    {rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.medium ?? 0), 0) || "—"}
                  </td>
                  <td className="sticky left-[416px] z-10 border-t border-border bg-background px-3 py-2 text-right font-bold text-hard">
                    {rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.hard ?? 0), 0) || "—"}
                  </td>
                  <td className="sticky left-[472px] z-10 border-t border-border bg-background px-3 py-2 text-right font-bold text-easy">
                    {rows.reduce((s, r) => s + (rangeGainByStudent.get(r.id)?.easy ?? 0), 0) || "—"}
                  </td>
                  <td className="sticky left-[528px] z-10 border-t border-border bg-background px-3 py-2 text-right font-bold text-medium">
                    {rows.reduce((s, r) => s + (rangeGainByStudent.get(r.id)?.medium ?? 0), 0) ||
                      "—"}
                  </td>
                  <td className="sticky left-[584px] z-10 border-t border-r border-border bg-background px-3 py-2 text-right font-bold text-hard">
                    {rows.reduce((s, r) => s + (rangeGainByStudent.get(r.id)?.hard ?? 0), 0) || "—"}
                  </td>
                  {cohort.map((c, i) => (
                    <td
                      key={i}
                      className="w-[56px] min-w-[56px] max-w-[56px] border-t border-border px-2 py-1.5 text-center tabular-nums"
                      title={`Cohort · ${fmtShort(allDates[i])} · ${c.total} solved · +${c.gain} that day`}
                    >
                      <div className="flex flex-col items-center leading-none">
                        {view !== "gain" && (
                          <span className="text-[11px] font-bold text-primary">
                            {c.total || "·"}
                          </span>
                        )}
                        {view !== "total" && (
                          <GainBadge gain={c.gain} span={c.span} stacked={view === "both"} />
                        )}
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
