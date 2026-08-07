import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpDown } from "lucide-react";

import type { CohortPlatform, CohortPlatformStat } from "@/lib/classrooms.functions";

/**
 * The roster through one platform's lens.
 *
 * A separate table rather than extra columns on the main one, deliberately. The
 * default view already carries fifteen LeetCode-shaped columns (Total/E/M/H,
 * Today/Yesterday/Week/30d); bolting five platforms' worth of metrics onto it
 * would produce a grid nobody can read, and every platform reports a different
 * subset anyway.
 *
 * The metric column follows the platform's own `rank_metric`, so Codeforces
 * sorts by rating and LeetCode by solved count. Sorting a rated platform by
 * problems solved would put a 900-rated grinder above a 1900-rated competitor.
 */

type Row = {
  id: string;
  name: string;
  roll: string;
  stat: CohortPlatformStat | undefined;
};

function metricOf(stat: CohortPlatformStat | undefined, metric: string): number | null {
  if (!stat) return null;
  if (metric === "rating") return stat.rating;
  if (metric === "score") return stat.platform_score ?? stat.total_solved;
  return stat.total_solved;
}

export function CohortPlatformTable({
  platform,
  students,
}: {
  platform: CohortPlatform;
  students: {
    id: string;
    name: string;
    roll: string;
    platformStats: Record<string, CohortPlatformStat>;
  }[];
}) {
  const [desc, setDesc] = useState(true);

  const rows: Row[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    roll: s.roll,
    stat: s.platformStats?.[platform.id],
  }));

  const onPlatform = rows.filter((r) => r.stat);
  const missing = rows.length - onPlatform.length;

  const sorted = [...onPlatform].sort((a, b) => {
    const av = metricOf(a.stat, platform.rank_metric);
    const bv = metricOf(b.stat, platform.rank_metric);
    // Students with no value sort last in BOTH directions — an unfetched account
    // is absence of data, not a score of zero.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return desc ? bv - av : av - bv;
  });

  const metricLabel =
    platform.rank_metric === "rating"
      ? "Rating"
      : platform.rank_metric === "score"
        ? "Score"
        : "Solved";

  if (onPlatform.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No student in this cohort has a {platform.name} handle yet.
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          Add a “{platform.id}” column to your import file to start tracking it.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {platform.name} · ranked by {platform.rank_metric}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {onPlatform.length} of {rows.length} students
          {missing > 0 && <span className="text-medium"> · {missing} without a handle</span>}
        </span>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Student</th>
            <th className="px-3 py-2">Roll</th>
            <th className="px-3 py-2">Handle</th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                onClick={() => setDesc((d) => !d)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {metricLabel} <ArrowUpDown className="size-3" />
              </button>
            </th>
            {platform.rank_metric === "rating" && <th className="px-3 py-2 text-right">Peak</th>}
            {platform.rank_metric !== "solved" && <th className="px-3 py-2 text-right">Solved</th>}
            <th className="px-3 py-2 text-right">World</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const v = metricOf(r.stat, platform.rank_metric);
            return (
              <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <Link
                    to="/students/$roll"
                    params={{ roll: r.roll }}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.roll}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    @{r.stat!.handle}
                    {r.stat!.fetch_status === "partial" && (
                      <span className="text-medium" title="Still being fetched">
                        ·
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-bold">
                  {v !== null ? (
                    Math.round(v).toLocaleString()
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {platform.rank_metric === "rating" && (
                  <td className="px-3 py-2.5 text-right text-muted-foreground">
                    {r.stat!.max_rating ? Math.round(r.stat!.max_rating).toLocaleString() : "—"}
                  </td>
                )}
                {platform.rank_metric !== "solved" && (
                  <td className="px-3 py-2.5 text-right text-muted-foreground">
                    {r.stat!.total_solved ?? "—"}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right text-muted-foreground">
                  {r.stat!.global_rank ? `#${r.stat!.global_rank.toLocaleString()}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tab strip: "All Platforms" plus one tab per platform the cohort actually uses. */
export function PlatformTabs({
  platforms,
  value,
  onChange,
}: {
  platforms: CohortPlatform[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (platforms.length === 0) return null;
  const tabs = [{ id: "overall", name: "Overall" }, ...platforms];

  return (
    <div className="mb-4 flex flex-wrap gap-1.5 border-b border-border pb-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={
            value === t.id
              ? "rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary"
              : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          }
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
