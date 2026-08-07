import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Trophy } from "lucide-react";

import type { CohortPlatform, CohortPlatformStat } from "@/lib/classrooms.functions";
import { SectionTitle } from "@/components/stat-card";
import { lensMetric } from "@/lib/platform-lens";

/**
 * The cohort across every platform at once.
 *
 * This is the only view that can answer "who is strongest overall" — no single
 * platform can, because a Codeforces specialist and a LeetCode grinder are not
 * comparable on either platform's own metric. That comparison is exactly what
 * the Almanac Score exists for.
 *
 * ── What this deliberately does NOT render ─────────────────────────────────
 * Stat cards and a leaderboard. It used to render four cards — Students, Avg
 * Almanac Score, Problems Solved, Platforms — which are the exact four the page
 * now draws above it from the same numbers, so they appeared twice on every
 * load. Same for the score leaderboard, which is a tab in the insight panel.
 *
 * What is left is unique: the per-platform comparison table and the ranked
 * roster. Everything is derived from what getClassroom already returns; there is
 * no extra query behind this view.
 */

export type OverallStudent = {
  id: string;
  name: string;
  roll: string;
  ranks: {
    almanac_score: number;
    college_rank: number;
    college_total: number;
  } | null;
  platformStats: Record<string, CohortPlatformStat>;
};

// Shared with every other lens-aware view — see platform-lens.ts.
const metricOf = lensMetric;

/** Sum of solved across platforms, or null when nothing has been fetched yet. */
function combinedSolved(s: OverallStudent): number | null {
  const vals = Object.values(s.platformStats ?? {})
    .map((p) => p.total_solved)
    .filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export function CohortOverall({
  students,
  platforms,
}: {
  students: OverallStudent[];
  platforms: CohortPlatform[];
}) {
  const scored = useMemo(
    () =>
      [...students].sort((a, b) => (b.ranks?.almanac_score ?? 0) - (a.ranks?.almanac_score ?? 0)),
    [students],
  );

  /*
    Class rank from Almanac Score, so it agrees with College rank.

    It used to be computed by sorting on the LeetCode solved count while College
    rank came from student_ranks_v2 (Almanac Score) — so a student could read as
    Class #1 and College #40 with nothing on screen explaining the difference.

    dense_rank semantics, matching the SQL: ties share a place and the next
    student takes the following one, so there are no gaps to misread as a bug.
  */
  const classRank = useMemo(() => {
    const map = new Map<string, number>();
    let place = 0;
    let prev: number | null = null;
    for (const s of scored) {
      const score = s.ranks?.almanac_score ?? 0;
      if (prev === null || score !== prev) place += 1;
      prev = score;
      map.set(s.id, place);
    }
    return map;
  }, [scored]);

  // One row per platform: how this cohort is doing on each.
  const perPlatform = useMemo(
    () =>
      platforms.map((p) => {
        const stats = students
          .map((s) => s.platformStats?.[p.id])
          .filter((x): x is CohortPlatformStat => !!x);
        const values = stats
          .map((st) => metricOf(st, p.rank_metric))
          .filter((v): v is number => v !== null);

        const best = students
          .map((s) => ({ s, v: metricOf(s.platformStats?.[p.id], p.rank_metric) }))
          .filter((x) => x.v !== null)
          .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0];

        return {
          platform: p,
          onPlatform: stats.length,
          coverage: students.length ? Math.round((stats.length / students.length) * 100) : 0,
          avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
          best: best?.s ?? null,
          bestValue: best?.v ?? null,
          solved: stats.reduce((a, st) => a + (st.total_solved ?? 0), 0),
        };
      }),
    [platforms, students],
  );

  return (
    <div className="space-y-6">
      {/* How the cohort is doing on each platform */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2">
          <SectionTitle>Performance by Platform</SectionTitle>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Platform</th>
              <th className="px-3 py-2 text-right">Students</th>
              <th className="px-3 py-2 text-right">Coverage</th>
              <th className="px-3 py-2 text-right">Avg</th>
              <th className="px-3 py-2 text-right">Solved</th>
              <th className="px-3 py-2">Top performer</th>
            </tr>
          </thead>
          <tbody>
            {perPlatform.map((r) => (
              <tr
                key={r.platform.id}
                className="border-b border-border/50 last:border-0 hover:bg-muted/30"
              >
                <td className="px-3 py-2.5 font-medium">{r.platform.name}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {r.onPlatform}
                  <span className="text-muted-foreground">/{students.length}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className={r.coverage < 50 ? "text-medium" : "text-easy"}>
                    {r.coverage}%
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-bold">
                  {r.avg !== null ? r.avg.toLocaleString() : <Dash />}
                  <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                    {r.platform.rank_metric}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {r.solved ? r.solved.toLocaleString() : <Dash />}
                </td>
                <td className="px-3 py-2.5">
                  {r.best ? (
                    <Link
                      to="/students/$roll"
                      params={{ roll: r.best.roll }}
                      className="text-xs hover:text-primary hover:underline"
                    >
                      {r.best.name}
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {r.bestValue?.toLocaleString()}
                      </span>
                    </Link>
                  ) : (
                    <Dash />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Full roster */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Roll</th>
              <th className="px-3 py-2 text-right">Almanac Score</th>
              <th className="px-3 py-2 text-right" title="Rank in this cohort by Almanac Score">
                Class
              </th>
              <th className="px-3 py-2 text-right" title="Rank across the college by Almanac Score">
                College
              </th>
              <th className="px-3 py-2">Platforms</th>
              <th className="px-3 py-2 text-right">Solved</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((s, i) => {
              const score = s.ranks?.almanac_score ?? 0;
              const solved = combinedSolved(s);
              const on = platforms.filter((p) => s.platformStats?.[p.id]);
              return (
                <tr
                  key={s.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      to="/students/$roll"
                      params={{ roll: s.roll }}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{s.roll}</td>
                  <td className="px-3 py-2.5 text-right font-bold">
                    {score > 0 ? Math.round(score).toLocaleString() : <Dash />}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-primary">
                    {score > 0 ? `#${classRank.get(s.id)}` : <Dash />}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {s.ranks?.college_rank ? (
                      <span className="inline-flex items-center gap-1">
                        <Trophy className="size-3 text-primary" />#{s.ranks.college_rank}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {on.length === 0 && <Dash />}
                      {on.map((p) => (
                        <span
                          key={p.id}
                          title={p.name}
                          className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] uppercase text-muted-foreground"
                        >
                          {p.id.slice(0, 2)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {solved !== null ? solved.toLocaleString() : <Dash />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Absence of data, never a zero.
 *
 * A student who has not been fetched and a student who has genuinely solved
 * nothing are opposite conclusions; rendering both as "0" makes them
 * indistinguishable. Same rule the adapters follow when they return undefined
 * rather than 0 for a field a platform did not report.
 */
function Dash() {
  return <span className="text-muted-foreground">—</span>;
}
