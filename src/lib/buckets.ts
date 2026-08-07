// Behavioral buckets that group students by activity/skill signals.
// Used as filters on the classroom detail page.
import { todayCount, thisWeekCount, lastNDaysCount } from "./date-buckets";

export type StudentRow = {
  id: string;
  name: string;
  roll: string;
  leetcode_id: string;
  total: number;
  easy: number;
  medium: number;
  hard: number;
  today: number;
  yesterday: number;
  week: number;
  month: number;
  last30: number;
  streak: number;
  rank: number;
  calendar: Record<string, number>;
};

export const BUCKETS = [
  { id: "all", label: "All", color: "muted-foreground" },
  { id: "active_today", label: "Active Today", color: "primary" },
  { id: "weekly_warriors", label: "Weekly Warriors", color: "easy" },
  { id: "consistent", label: "Consistent (7d streak)", color: "primary" },
  { id: "top_performers", label: "Top Performers", color: "easy" },
  { id: "rising", label: "Rising", color: "medium" },
  { id: "at_risk", label: "At Risk", color: "medium" },
  { id: "silent", label: "Silent (30d)", color: "hard" },
  { id: "hard_hitters", label: "Hard Hitters", color: "hard" },
] as const;

export type BucketId = (typeof BUCKETS)[number]["id"];

export function filterBucket(rows: StudentRow[], bucket: BucketId): StudentRow[] {
  switch (bucket) {
    case "all":
      return rows;
    case "active_today":
      return rows.filter((r) => r.today > 0);
    case "weekly_warriors":
      return rows.filter((r) => r.week >= 10);
    case "consistent":
      return rows.filter((r) => r.streak >= 7);
    case "top_performers": {
      const sorted = [...rows].sort((a, b) => b.total - a.total);
      const cutoff = Math.max(1, Math.floor(sorted.length * 0.2));
      return sorted.slice(0, cutoff);
    }
    case "rising":
      return rows.filter((r) => r.last30 >= 15 && r.total < 200);
    case "at_risk":
      return rows.filter((r) => r.last30 < 5 && r.total > 0);
    case "silent":
      return rows.filter((r) => r.last30 === 0);
    case "hard_hitters":
      return rows.filter((r) => r.hard >= 20);
  }
}

export function bucketCounts(rows: StudentRow[]): Record<BucketId, number> {
  const out = {} as Record<BucketId, number>;
  for (const b of BUCKETS) out[b.id] = filterBucket(rows, b.id).length;
  return out;
}

/**
 * Every count derived from `submission_calendar` is SUBMISSIONS on a UTC day —
 * retries included — frozen at the last scrape. `total`/`easy`/`medium`/`hard`
 * are unique problems SOLVED. The two are not interchangeable, which is why the
 * "Today" figure and the Daily Matrix's newly-solved delta legitimately differ.
 */
export function toStudentRow(s: {
  id: string;
  name: string;
  roll: string;
  leetcode_id: string;
  stats: any;
}): StudentRow {
  const cal = (s.stats?.submission_calendar ?? {}) as Record<string, number>;
  // `month` and `last30` are the same 30-day window; it was being summed twice.
  const last30 = lastNDaysCount(cal, 30);
  return {
    id: s.id,
    name: s.name,
    roll: s.roll,
    leetcode_id: s.leetcode_id,
    total: s.stats?.total_solved ?? 0,
    easy: s.stats?.easy_solved ?? 0,
    medium: s.stats?.medium_solved ?? 0,
    hard: s.stats?.hard_solved ?? 0,
    today: todayCount(cal),
    yesterday: (() => {
      const y = new Date();
      y.setUTCDate(y.getUTCDate() - 1);
      return (
        cal[
          String(Math.floor(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()) / 1000))
        ] ?? 0
      );
    })(),
    week: thisWeekCount(cal),
    month: last30,
    last30,
    streak: s.stats?.streak ?? 0,
    rank: s.stats?.ranking ?? Number.MAX_SAFE_INTEGER,
    calendar: cal,
  };
}
