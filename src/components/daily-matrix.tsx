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
    return <span className={cn("text-4xs text-muted-foreground/40", stacked && "mt-0.5")}>·</span>;
  }
  if (gain <= 0) {
    return <span className={cn("text-4xs text-muted-foreground/40", stacked && "mt-0.5")}>–</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-px font-bold",
        // A gain across a snapshot gap isn't one day's work. Amber marks it so a
        // caught-up backlog can't be misread as a single heroic day.
        span > 1 ? "text-medium" : "text-easy",
        stacked ? "mt-0.5 text-4xs" : "text-2xs",
      )}
    >
      <ArrowUp className={stacked ? "size-2.5" : "size-3"} strokeWidth={3} />
      {gain}
      {span > 1 && <span className="ml-px opacity-70">/{span}d</span>}
    </span>
  );
}

/**
 * A cumulative figure with its movement underneath.
 *
 * The range gain used to occupy three sticky columns of its own (ΔE/ΔM/ΔH),
 * which meant eight frozen columns before the first date and forced the reader
 * to match "E" against "ΔE" several columns away. Pairing each total with its
 * own delta says the same thing in half the width, and matches how the date
 * cells already stack a total over its daily gain.
 *
 * Null and zero read differently on purpose: nothing at all means we have no
 * earlier snapshot to measure from, "–" means measured and flat.
 */
function StackedCell({
  total,
  gain,
  tone,
}: {
  total: number | null;
  gain: number | null;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className={cn("text-sm font-bold tabular-nums", tone)}>
        {total ?? <span className="text-muted-foreground/50">—</span>}
      </span>
      {gain === null ? (
        <span className="mt-1 text-4xs text-muted-foreground/40">·</span>
      ) : gain <= 0 ? (
        <span className="mt-1 text-4xs text-muted-foreground/40">–</span>
      ) : (
        <span className={cn("mt-1 inline-flex items-center gap-px text-3xs font-bold", tone)}>
          <ArrowUp className="size-2.5" strokeWidth={3} />
          {gain}
        </span>
      )}
    </div>
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
  const default30d = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const classStartIso = startDate.toISOString().slice(0, 10);
  const minDate = classStartIso < default30d ? classStartIso : default30d;
  const [customStart, setCustomStart] = useState<string>(minDate);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);
  const [view, setView] = useState<MatrixView>("both");

  // Keep date window synchronized if startDate prop changes
  useEffect(() => {
    const cIso = startDate.toISOString().slice(0, 10);
    const m = cIso < default30d ? cIso : default30d;
    setCustomStart((prev) => (prev > todayIso ? m : prev));
  }, [startDate, default30d, todayIso]);

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
    const out: string[] = [];
    const cursor = new Date(`${customStart}T00:00:00Z`);
    const end = new Date(`${customEnd}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }, [customStart, customEnd]);

  /*
    Short ranges stretch to fill the width; long ones keep a fixed column and
    scroll.
  */
  const flexDates = allDates.length > 0 && allDates.length <= 14;

  /**
   * Per-student `date -> { total, gain, span }`.
   *
   * Carries forward the running total across dates after the student's first recorded
   * snapshot so that flat days render their true cumulative total with a "–" no-gain marker
   * rather than an empty "—" missing data placeholder.
   */
  const byStudent = useMemo(() => {
    const out = new Map<string, Map<string, Cell>>();
    for (const [studentId, v] of Object.entries(breakdown ?? {})) {
      const rawSnaps = [...v.snapshots].sort((a, b) => a.date.localeCompare(b.date));
      const m = new Map<string, Cell>();
      if (rawSnaps.length === 0) {
        out.set(studentId, m);
        continue;
      }

      // Map explicit snapshots
      const snapMap = new Map<
        string,
        { total: number; easy: number; medium: number; hard: number }
      >();
      for (const s of rawSnaps) {
        snapMap.set(s.date, s);
      }

      let prevTotal: number | null = null;
      let prevDate: string | null = null;
      let started = false;

      for (const d of allDates) {
        const explicit = snapMap.get(d);
        if (explicit) {
          started = true;
          const gain = prevTotal === null ? null : Math.max(0, explicit.total - prevTotal);
          const span = prevDate === null ? 1 : daysBetween(prevDate, d);
          m.set(d, {
            total: explicit.total,
            gain,
            span,
          });
          prevTotal = explicit.total;
          prevDate = d;
        } else if (started && prevTotal !== null) {
          // Carry forward previous running total with 0 gain
          m.set(d, {
            total: prevTotal,
            gain: 0,
            span: 1,
          });
        }
      }

      out.set(studentId, m);
    }
    return out;
  }, [breakdown, allDates]);

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
        easy: Math.max(0, last.easy - first.easy),
        medium: Math.max(0, last.medium - first.medium),
        hard: Math.max(0, last.hard - first.hard),
        total: Math.max(0, last.total - first.total),
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
      // Plain words, not "Δ": a spreadsheet that guesses the wrong encoding
      // renders the glyph as mojibake in the header row.
      "New Easy",
      "New Medium",
      "New Hard",
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
        <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
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
        <div className="flex items-center gap-2 font-mono text-4xs uppercase tracking-wider text-muted-foreground">
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
          <span className="inline-flex items-center gap-1 opacity-60">
            ·
            <ArrowUp className="size-2.5" strokeWidth={3} />= newly solved in the selected range
          </span>
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
            id="export-matrix"
            onClick={handleExportCsv}
            className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-accent"
          >
            Export CSV
          </button>
        </div>
      </div>

      {isPending ? (
        <SkeletonTable rows={Math.min(Math.max(rows.length, 4), 10)} columns={5} />
      ) : (
        <div
          ref={scrollRef}
          /*
            Full width, like every other card on the page.

            This was `w-fit max-w-[1200px]`, which shrank the bordered box to the
            table and capped it — so on a wide screen the matrix sat in a narrow
            column with dead space beside it, out of line with everything above.
            The date columns are a fixed 56px (see the colgroup), so filling the
            width cannot squeeze them: a wider screen simply shows more days, and
            anything that does not fit scrolls. That is the behaviour the fixed
            widths were for; the extra cap was doing a second, conflicting job.
          */
          className="max-h-[70vh] w-full overflow-auto rounded-lg border border-border bg-surface"
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
          <table
            className={cn(
              "table-fixed border-separate border-spacing-0 text-sm",
              flexDates ? "w-full" : "w-max",
            )}
          >
            <colgroup>
              <col className="w-[224px]" />
              <col className="w-[84px]" />
              <col className="w-[72px]" />
              <col className="w-[72px]" />
              <col className="w-[72px]" />
              {allDates.map((d) => (
                <col key={d} className={flexDates ? undefined : "w-[56px]"} />
              ))}
            </colgroup>
            <thead>
              <tr className="font-mono text-3xs font-bold uppercase tracking-wider text-foreground">
                <th className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-r border-border bg-background px-3 py-2 text-left">
                  Student
                </th>
                <th
                  className="sticky left-[224px] top-0 z-30 border-b border-border bg-background px-3 py-2 text-right"
                  title="Total solved to date, and how many of them are new in this range"
                >
                  Σ Total
                </th>
                <th
                  className="sticky left-[308px] top-0 z-30 border-b border-border bg-background px-3 py-2 text-right text-easy"
                  title="Easy — solved to date, and new in this range"
                >
                  E
                </th>
                <th
                  className="sticky left-[380px] top-0 z-30 border-b border-border bg-background px-3 py-2 text-right text-medium"
                  title="Medium — solved to date, and new in this range"
                >
                  M
                </th>
                <th
                  className="sticky left-[452px] top-0 z-30 border-b border-r border-border bg-background px-3 py-2 text-right text-hard"
                  title="Hard — solved to date, and new in this range"
                >
                  H
                </th>
                {allDates.map((date) => (
                  <th
                    key={date}
                    className={cn(
                      "sticky top-0 z-20 border-b border-border bg-background px-2 py-1 text-center align-bottom",
                      flexDates ? "min-w-[44px]" : "w-[56px] min-w-[56px] max-w-[56px]",
                    )}
                  >
                    <div className="text-3xs font-bold leading-tight">{fmtShort(date)}</div>
                    <div className="text-5xs opacity-60">{fmtWeekday(date)}</div>
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
                        <div className="truncate text-3xs text-muted-foreground">{r.roll}</div>
                      </Link>
                    </td>
                    <td className="sticky left-[224px] z-10 border-b border-border bg-surface px-3 py-2 text-right group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      <StackedCell
                        total={latest?.total ?? null}
                        gain={rangeGain?.total ?? null}
                        tone="text-foreground"
                      />
                    </td>
                    <td className="sticky left-[308px] z-10 border-b border-border bg-surface px-3 py-2 text-right group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      <StackedCell
                        total={latest?.easy ?? null}
                        gain={rangeGain?.easy ?? null}
                        tone="text-easy"
                      />
                    </td>
                    <td className="sticky left-[380px] z-10 border-b border-border bg-surface px-3 py-2 text-right group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      <StackedCell
                        total={latest?.medium ?? null}
                        gain={rangeGain?.medium ?? null}
                        tone="text-medium"
                      />
                    </td>
                    <td className="sticky left-[452px] z-10 border-b border-r border-border bg-surface px-3 py-2 text-right group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                      <StackedCell
                        total={latest?.hard ?? null}
                        gain={rangeGain?.hard ?? null}
                        tone="text-hard"
                      />
                    </td>
                    {allDates.map((date) => {
                      const cell = byStudent.get(r.id)?.get(date);
                      return (
                        <td
                          key={date}
                          className={cn(
                            "border-b border-border/50 px-2 py-1.5 text-center tabular-nums",
                            flexDates ? "min-w-[44px]" : "w-[56px] min-w-[56px] max-w-[56px]",
                          )}
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
                            <span className="text-2xs font-bold text-foreground">—</span>
                          ) : (
                            <div className="flex flex-col items-center leading-none">
                              {view !== "gain" && (
                                <span className="text-2xs font-bold text-foreground">
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
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5 + allDates.length}
                    className="border-b border-border/50 px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No students found matching your search or filters.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-background font-mono text-3xs uppercase tracking-wider">
                  <td className="sticky left-0 z-10 border-t border-r border-border bg-background px-3 py-2 font-bold">
                    Cohort / day
                  </td>
                  <td className="sticky left-[224px] z-10 border-t border-border bg-background px-3 py-2 text-right">
                    <StackedCell
                      total={rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.total ?? 0), 0)}
                      gain={rows.reduce(
                        (s, r) => s + (rangeGainByStudent.get(r.id)?.total ?? 0),
                        0,
                      )}
                      tone="text-primary"
                    />
                  </td>
                  <td className="sticky left-[308px] z-10 border-t border-border bg-background px-3 py-2 text-right">
                    <StackedCell
                      total={rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.easy ?? 0), 0)}
                      gain={rows.reduce((s, r) => s + (rangeGainByStudent.get(r.id)?.easy ?? 0), 0)}
                      tone="text-easy"
                    />
                  </td>
                  <td className="sticky left-[380px] z-10 border-t border-border bg-background px-3 py-2 text-right">
                    <StackedCell
                      total={rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.medium ?? 0), 0)}
                      gain={rows.reduce(
                        (s, r) => s + (rangeGainByStudent.get(r.id)?.medium ?? 0),
                        0,
                      )}
                      tone="text-medium"
                    />
                  </td>
                  <td className="sticky left-[452px] z-10 border-t border-r border-border bg-background px-3 py-2 text-right">
                    <StackedCell
                      total={rows.reduce((s, r) => s + (breakdown?.[r.id]?.latest?.hard ?? 0), 0)}
                      gain={rows.reduce((s, r) => s + (rangeGainByStudent.get(r.id)?.hard ?? 0), 0)}
                      tone="text-hard"
                    />
                  </td>
                  {cohort.map((c, i) => (
                    <td
                      key={i}
                      className={cn(
                        "border-t border-border px-2 py-1.5 text-center tabular-nums",
                        flexDates ? "min-w-[44px]" : "w-[56px] min-w-[56px] max-w-[56px]",
                      )}
                      title={`Cohort · ${fmtShort(allDates[i])} · ${c.total} solved · +${c.gain} that day`}
                    >
                      <div className="flex flex-col items-center leading-none">
                        {view !== "gain" && (
                          <span className="text-2xs font-bold text-primary">{c.total || "·"}</span>
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
