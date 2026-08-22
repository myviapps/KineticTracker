import type { CohortPlatform, CohortPlatformStat } from "@/lib/classrooms.functions";
import { CohortPlatformTable } from "@/components/cohort-platform-table";

/**
 * The roster for one platform.
 *
 * ── What this deliberately does NOT render ─────────────────────────────────
 * Stat cards, a distribution chip row and a leaderboard. It used to render all
 * three, which was correct while it was a self-contained tab — but the platform
 * lens now lives in the page's sticky bar and the page draws those itself. Left
 * as it was, selecting Codeforces produced eleven stat cards, the same
 * distribution three times and two leaderboards.
 *
 * So this is the table plus the one thing the page cannot know: the FETCH STATE
 * of the accounts behind it. "Nobody scored above 1400" and "we never managed to
 * fetch these twelve students" look identical in a distribution, and only this
 * component has the per-account status to tell them apart.
 */

type Student = {
  id: string;
  name: string;
  roll: string;
  platformStats: Record<string, CohortPlatformStat>;
};

export function CohortPlatformReport({
  platform,
  students,
}: {
  platform: CohortPlatform;
  students: Student[];
}) {
  const rows = students.map((s) => ({ s, stat: s.platformStats?.[platform.id] }));
  const onPlatform = rows.filter((r) => r.stat);

  // States every platform has, regardless of metric.
  const states = {
    never: onPlatform.filter((r) => r.stat?.total_solved === null && r.stat?.rating === null)
      .length,
    partial: onPlatform.filter((r) => r.stat?.fetch_status === "partial").length,
    missing: rows.length - onPlatform.length,
  };

  if (onPlatform.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No student in this cohort has a {platform.name} handle yet.
        </p>
        <p className="mt-1 font-mono text-3xs text-muted-foreground">
          Add a “{platform.id}” column to your import file, or set it on a student, to start
          tracking it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(states.partial > 0 || states.never > 0 || states.missing > 0) && (
        <div className="flex flex-wrap gap-3 font-mono text-3xs text-muted-foreground">
          {states.missing > 0 && <span>{states.missing} without a handle</span>}
          {states.never > 0 && <span>{states.never} never fetched</span>}
          {states.partial > 0 && (
            <span className="text-medium">{states.partial} still filling in</span>
          )}
        </div>
      )}

      <CohortPlatformTable platform={platform} students={students} />
    </div>
  );
}
