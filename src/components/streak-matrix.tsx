import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { StudentRow } from "@/lib/buckets";
import {
  dayCount,
  longestStreakBetween,
  shiftDays,
  streakEndingOn,
  type CalendarMap,
} from "@/lib/date-buckets";
import { cn } from "@/lib/utils";

/**
 * Consistency over a window, and what each student was carrying on a given day.
 *
 * ── Why this is not a mode on the Daily Matrix ─────────────────────────────
 * They look alike and read from different worlds. The Daily Matrix is built on
 * `daily_snapshots`, which only has rows for days a refresh actually ran — fine
 * for "how many did they solve", useless for "were they active", because a
 * missing row there means "we did not look", not "they did not work".
 *
 * This grid reads LeetCode's submission calendar, which is a COMPLETE
 * day-by-day record: a day absent from it is a day with no submissions, full
 * stop. That is the only source in the app that can answer a question about a
 * past date honestly, so the streak view has to be its own thing rather than a
 * toggle on the other one.
 *
 * ── The two streak columns ─────────────────────────────────────────────────
 * "Into" is the run carried INTO the anchor date, the anchor excluded.
 * "Through" includes it. The difference between the two is exactly "did they
 * keep it alive on the day" — which is the whole reason to ask about a specific
 * date rather than about today.
 */

type Props = {
  rows: StudentRow[];
  /** The anchor date, X. Interpreted as a UTC day. */
  anchor: Date;
  /** How many days of grid to show, ending on the anchor. */
  days: number;
};

/**
 * Earliest date the stored calendar can speak to.
 *
 * The scraper fetches the current year and the one before it, so anything older
 * is not "no activity" — it is outside what we hold. Reporting 0 there would be
 * inventing a fact, so those cells read "—" instead.
 */
function coverageStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
}

type StudentStreaks = {
  row: StudentRow;
  /** Null = we cannot answer for this student, which is not the same as zero. */
  into: number | null;
  through: number | null;
  longest: number | null;
  activeDays: number;
};

const fmtDay = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StreakMatrix({ rows, anchor, days }: Props) {
  const dates = useMemo(() => {
    const out: Date[] = [];
    for (let i = days - 1; i >= 0; i--) out.push(shiftDays(anchor, -i));
    return out;
  }, [anchor, days]);

  const start = dates[0];
  const covered = start >= coverageStart() && anchor <= new Date();

  const streaks = useMemo<StudentStreaks[]>(
    () =>
      rows.map((row) => {
        const cal = row.calendar as CalendarMap;
        /*
          An empty calendar means this student has never been scraped
          successfully, or their profile is private. Every number below would
          come out 0, and 0 here reads as "never submitted" rather than "we do
          not know" — the distinction this whole view depends on.
        */
        const known = Object.keys(cal).length > 0 && covered;
        return {
          row,
          into: known ? streakEndingOn(cal, shiftDays(anchor, -1)) : null,
          through: known ? streakEndingOn(cal, anchor) : null,
          longest: known ? longestStreakBetween(cal, start, anchor) : null,
          activeDays: known ? dates.filter((d) => dayCount(cal, d) > 0).length : 0,
        };
      }),
    [rows, anchor, dates, start, covered],
  );

  // Sorted by what the view is about. Ties break on the longest run in range, so
  // two students both idle on the anchor still order by how they actually did.
  const sorted = useMemo(
    () =>
      [...streaks].sort(
        (a, b) => (b.through ?? -1) - (a.through ?? -1) || (b.longest ?? -1) - (a.longest ?? -1),
      ),
    [streaks],
  );

  const unknown = streaks.filter((s) => s.into === null).length;

  /*
    Same columns, same names, same order as the workbook's Streaks sheet.

    A per-day column follows for each date in the window, holding the submission
    count — so this file is the grid, not a summary of it. Deliberately mirrors
    the sheet rather than inventing its own shape: two exports of one view that
    disagree about column names are two things to reconcile later.
  */
  function exportCsv() {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const header = [
      "Student",
      "Roll",
      "As Of",
      "Streak Into",
      "Streak Through",
      `Longest In ${days}d`,
      `Active Days In ${days}d`,
      "Active %",
      ...dates.map(iso),
    ];

    const lines = sorted.map(({ row, into, through, longest, activeDays }) => {
      const cal = row.calendar as CalendarMap;
      const known = into !== null;
      return [
        row.name,
        row.roll,
        iso(anchor),
        into,
        through,
        longest,
        known ? activeDays : null,
        known ? Math.round((activeDays / days) * 100) : null,
        ...dates.map((d) => (known ? dayCount(cal, d) : null)),
      ]
        .map(esc)
        .join(",");
    });

    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streaks_${iso(anchor)}_${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No students match this filter.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!covered && (
        <p className="rounded-lg border border-medium/30 bg-medium/5 p-3 text-xs text-muted-foreground">
          <strong className="text-medium">Outside stored history.</strong> The submission calendar
          covers this year and last, so nothing before {coverageStart().toUTCString().slice(5, 16)}{" "}
          can be answered. Those cells read &ldquo;&mdash;&rdquo; rather than 0 — we did not observe
          inactivity, we simply have no record of it.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          id="export-streak"
          variant="outline"
          size="sm"
          onClick={exportCsv}
          title="Export this grid as CSV (M)"
        >
          <Download className="mr-1 size-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="max-h-[70vh] w-full overflow-auto rounded-lg border border-border bg-surface">
        {/*
          table-fixed + colgroup, and the sticky offsets below assume exactly
          these widths — the same constraint the Daily Matrix documents. `min-w`
          is a floor rather than a width, and one over-wide header is all it
          takes to shear every sticky column after it.
        */}
        <table className="w-max table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col className="w-[224px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            {dates.map((d) => (
              <col key={d.toISOString()} className="w-[26px]" />
            ))}
          </colgroup>
          <thead>
            <tr className="font-mono text-3xs font-bold uppercase tracking-wider text-foreground">
              <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-background px-3 py-2 text-left">
                Student
              </th>
              <th
                className="sticky left-[224px] top-0 z-30 border-b border-border bg-background px-2 py-2 text-right"
                title={`Consecutive active days ending the day BEFORE ${fmtDay(anchor)} — the run carried into it`}
              >
                Into
              </th>
              <th
                className="sticky left-[300px] top-0 z-30 border-b border-border bg-background px-2 py-2 text-right text-primary"
                title={`Consecutive active days ending ON ${fmtDay(anchor)}, that day included`}
              >
                Through
              </th>
              <th
                className="sticky left-[376px] top-0 z-30 border-b border-r border-border bg-background px-2 py-2 text-right"
                title="Longest unbroken run inside the window shown"
              >
                Best
              </th>
              {dates.map((d) => (
                <th
                  key={d.toISOString()}
                  title={`${WEEKDAY[d.getUTCDay()]} ${fmtDay(d)}`}
                  className={cn(
                    "sticky top-0 z-20 border-b border-border bg-background px-0 py-2 text-center align-bottom font-normal",
                    d.getTime() === anchor.getTime() && "text-primary",
                  )}
                >
                  {/* Only the anchor and week starts carry a label — one per
                      26px column would be unreadable at any useful window. */}
                  <span className="block text-5xs leading-none">
                    {d.getTime() === anchor.getTime() || d.getUTCDay() === 1 ? fmtDay(d) : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row, into, through, longest, activeDays }) => {
              const cal = row.calendar as CalendarMap;
              return (
                <tr key={row.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]">
                    <Link
                      to="/students/$roll"
                      params={{ roll: row.roll }}
                      className="block min-w-0"
                    >
                      <div
                        className="truncate font-sans text-xs font-semibold hover:text-primary"
                        title={row.name}
                      >
                        {row.name}
                      </div>
                      <div className="truncate text-3xs text-muted-foreground">
                        {row.roll}
                        {into !== null && (
                          <span className="ml-1.5">
                            · {activeDays}/{days} active
                          </span>
                        )}
                      </div>
                    </Link>
                  </td>
                  <StreakCell value={into} left="224px" />
                  <StreakCell value={through} left="300px" accent />
                  <StreakCell value={longest} left="376px" divider />
                  {dates.map((d) => {
                    const n = into === null ? null : dayCount(cal, d);
                    return (
                      <td
                        key={d.toISOString()}
                        title={
                          n === null
                            ? "No record for this day"
                            : `${fmtDay(d)} — ${n === 0 ? "no submissions" : `${n} submission${n === 1 ? "" : "s"}`}`
                        }
                        className="border-b border-border p-0 text-center"
                      >
                        <span
                          className={cn(
                            "mx-auto block size-[14px] rounded-[3px]",
                            n === null
                              ? "bg-transparent ring-1 ring-inset ring-border"
                              : n === 0
                                ? "bg-muted"
                                : n < 3
                                  ? "bg-primary/40"
                                  : n < 8
                                    ? "bg-primary/70"
                                    : "bg-primary",
                            d.getTime() === anchor.getTime() && "ring-1 ring-primary",
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-3xs uppercase tracking-widest text-muted-foreground">
        <span>
          <b className="text-foreground">Into</b> = run before {fmtDay(anchor)}
        </span>
        <span>
          <b className="text-primary">Through</b> = run including it
        </span>
        <span>
          <b className="text-foreground">Best</b> = longest run in {days}d
        </span>
        <span className="inline-flex items-center gap-1">
          less
          <span className="size-[10px] rounded-[2px] bg-muted" />
          <span className="size-[10px] rounded-[2px] bg-primary/40" />
          <span className="size-[10px] rounded-[2px] bg-primary/70" />
          <span className="size-[10px] rounded-[2px] bg-primary" />
          more
        </span>
        {unknown > 0 && (
          <span className="text-medium">
            {unknown} student{unknown === 1 ? "" : "s"} with no record
          </span>
        )}
      </div>
    </div>
  );
}

/** A sticky streak column. `null` renders an em dash, never 0 — not the same. */
function StreakCell({
  value,
  left,
  accent,
  divider,
}: {
  value: number | null;
  left: string;
  accent?: boolean;
  divider?: boolean;
}) {
  return (
    <td
      style={{ left }}
      className={cn(
        "sticky z-10 border-b border-border bg-surface px-2 py-2 text-right font-mono group-hover:bg-[color-mix(in_oklch,var(--primary)_5%,var(--surface))]",
        divider && "border-r",
      )}
    >
      {value === null ? (
        <span className="text-muted-foreground" title="No record for this date">
          —
        </span>
      ) : (
        <span
          className={cn(
            value === 0 && "text-muted-foreground",
            value > 0 && accent && "font-bold text-primary",
            value > 0 && !accent && "font-semibold",
          )}
        >
          {value}d
        </span>
      )}
    </td>
  );
}
