import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getPerformanceWindows, type PlatformWindow } from "@/lib/performance.functions";
import { SectionTitle } from "@/components/stat-card";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION } from "@/lib/chart-motion";

/**
 * This week / this month, per platform.
 *
 * The central rule here: a platform with no history must never render "0
 * solved". Daily history begins at a platform's first refresh, and
 * `solved_that_day` on that first snapshot is 0 by construction — so a naive
 * panel would report "nobody did anything" when the truth is "we have not been
 * watching long enough". Those are opposite conclusions and they look identical.
 *
 * `first_snapshot_date` drives a "collecting since …" state instead.
 *
 * Totals are labelled as totals over the window, never "per day":
 * solved_that_day differences against the previous SNAPSHOT, not yesterday, so a
 * weekly-refreshed platform lands seven days of gain on one date. The sum is
 * right; the daily shape is lumpy until every platform runs daily.
 */

function daysSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

export function PerformanceWindows() {
  const { data, isPending } = useQuery({
    queryKey: ["performance-windows"],
    queryFn: () => getPerformanceWindows({ data: { windows: [7, 30] } }),
    staleTime: 5 * 60_000,
  });

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
        Loading performance…
      </div>
    );
  }
  if (!data?.windows.length) return null;

  return (
    <div className="space-y-4">
      <SectionTitle>Performance</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.windows.map((w) => (
          <WindowCard key={w.days} days={w.days} platforms={w.platforms} />
        ))}
      </div>
    </div>
  );
}

function WindowCard({ days, platforms }: { days: number; platforms: PlatformWindow[] }) {
  const title = days === 7 ? "This Week" : days === 30 ? "This Month" : `Last ${days} days`;
  const withData = platforms.filter((p) => p.solved !== null);
  const total = withData.reduce((a, p) => a + (p.solved ?? 0), 0);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {/* "over the window", not "per day" — see the note at the top. */}
          {total.toLocaleString()} solved over {days}d
        </span>
      </div>

      <div className="space-y-3">
        {platforms.map((p) => (
          <PlatformRow key={p.platform_id} p={p} days={days} />
        ))}
      </div>
    </div>
  );
}

function PlatformRow({ p, days }: { p: PlatformWindow; days: number }) {
  const [cPrimary, cBorder, cSurface, cMutedFg] = useCssVars(
    "--primary",
    "--border",
    "--surface",
    "--muted-foreground",
  );

  /*
    Not enough history to make a claim.

    Two distinct cases, and neither may be shown as a zero:
      - the platform has never been snapshotted at all
      - it has been, but for fewer days than the window covers
  */
  const insufficient =
    p.first_snapshot_date === null || daysSince(p.first_snapshot_date) < Math.min(days, 2);

  if (insufficient) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
        <span className="text-sm font-medium">{p.platform_name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {p.first_snapshot_date
            ? `collecting since ${new Date(p.first_snapshot_date).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}`
            : "no history yet"}
          {p.tracked_students > 0 && ` · ${p.tracked_students} tracked`}
        </span>
      </div>
    );
  }

  const participation = p.tracked_students
    ? Math.round((p.active_students / p.tracked_students) * 100)
    : 0;

  return (
    <div className="border-b border-border/50 pb-2 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{p.platform_name}</span>
        <span className="font-mono text-xs">
          <b>{(p.solved ?? 0).toLocaleString()}</b>
          <span className="ml-1 text-muted-foreground">solved</span>
          <span className="ml-2 text-muted-foreground">
            {p.active_students}/{p.tracked_students} active ({participation}%)
          </span>
        </span>
      </div>

      {p.series.length > 1 && (
        <div className="mt-1 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={p.series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: cSurface,
                  border: `1px solid ${cBorder}`,
                  fontSize: 11,
                }}
                labelStyle={{ color: cMutedFg }}
              />
              <Line
                {...CHART_MOTION}
                type="monotone"
                dataKey="solved"
                stroke={cPrimary}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {p.days_covered < days && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {p.days_covered} of {days} days have data
        </p>
      )}
    </div>
  );
}
