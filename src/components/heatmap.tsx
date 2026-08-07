import { useMemo } from "react";
import { buildHeatmapGrid, type CalendarMap } from "@/lib/date-buckets";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucket(count: number): number {
  if (count === 0) return 0;
  if (count < 2) return 1;
  if (count < 5) return 2;
  if (count < 10) return 3;
  return 4;
}

export function Heatmap({ calendar }: { calendar: CalendarMap }) {
  const weeks = useMemo(() => buildHeatmapGrid(calendar), [calendar]);
  const total = useMemo(() => Object.values(calendar).reduce((s, n) => s + n, 0), [calendar]);

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((col, i) => {
    const m = col[0].date.getUTCMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: i, label: MONTHS[m] });
      lastMonth = m;
    }
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Submission Activity
          </h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {total} submissions this year
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">less</span>
          {[0, 1, 2, 3, 4].map((b) => (
            <div key={b} className={cn("size-3 rounded-sm", cellClass(b))} />
          ))}
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">more</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* month labels */}
          <div className="relative mb-1 h-4">
            {monthLabels.map((m) => (
              <span
                key={m.col}
                className="absolute font-mono text-[10px] text-muted-foreground"
                style={{ left: `${m.col * 14}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {/*
            No `transition-colors` on the cells. There are 365 of them, and a theme
            switch changes every --primary-derived fill at once — animating all of
            them together was the most expensive thing the toggle did, for an
            effect nobody can see on a 12px square. The ring on hover is instant
            by design.
          */}
          <div className="flex gap-[2px]">
            {weeks.map((col, i) => (
              <div key={i} className="flex flex-col gap-[2px]">
                {col.map((cell, j) => (
                  <div
                    key={j}
                    title={`${cell.date.toISOString().slice(0, 10)} · ${cell.count}`}
                    className={cn(
                      "size-3 rounded-[2px] hover:ring-1 hover:ring-primary",
                      cellClass(bucket(cell.count)),
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exported so the landing showcase mock stays in lockstep with the real
    product surface instead of copy-pasting five intensity classes that go
    stale. */
export function cellClass(b: number): string {
  switch (b) {
    case 0:
      return "bg-muted";
    case 1:
      return "bg-primary/25";
    case 2:
      return "bg-primary/50";
    case 3:
      return "bg-primary/75";
    default:
      return "bg-primary";
  }
}
