import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type LeaderboardEntry = {
  id: string;
  name: string;
  roll: string;
  total: number;
  /** Omit on a single-classroom board, where it would repeat on every row. */
  classroom?: string | null;
};

/**
 * Ranked leaderboard.
 *
 * Replaces a Recharts horizontal BarChart, which printed every student's exact
 * total on the axis — turning a motivational panel into a public score sheet —
 * and squeezed 20+ names into unreadable slivers. Here the bar carries the
 * comparison and the number stays hidden until you hover or focus a row, so
 * ranking is legible at a glance without broadcasting counts.
 */
export function LeaderboardBars({
  entries,
  className,
}: {
  entries: LeaderboardEntry[];
  className?: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No students to rank.
      </div>
    );
  }

  // Scale against the leader, not the axis max, so the top bar always fills.
  const max = Math.max(...entries.map((e) => e.total), 1);

  return (
    <ol className={cn("space-y-1", className)}>
      {entries.map((e, i) => {
        const pct = Math.max((e.total / max) * 100, e.total > 0 ? 2 : 0);
        const podium = i < 3;
        return (
          <li key={e.id}>
            <Link
              to="/students/$roll"
              params={{ roll: e.roll }}
              className="group/row flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span
                className={cn(
                  "w-6 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums",
                  podium ? "text-primary" : "text-muted-foreground/60",
                )}
              >
                {i + 1}
              </span>

              <span className="flex w-[38%] shrink-0 flex-col leading-tight">
                <span className="truncate text-xs font-medium">{e.name}</span>
                {e.classroom && (
                  <span className="truncate font-mono text-[9px] text-muted-foreground">
                    {e.classroom}
                  </span>
                )}
              </span>

              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
                    podium ? "bg-primary" : "bg-primary/45",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </span>

              {/*
                Revealed on hover/focus only. Kept in the layout (not toggled with
                `hidden`) so rows don't reflow, and readable by screen readers
                regardless of opacity.
              */}
              <span className="w-12 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
                {e.total.toLocaleString()}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
