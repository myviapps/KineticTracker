// The single answer to "what does this platform mean".
//
// Every page used to assume LeetCode: the stat cards read submission_calendar,
// the distribution was Easy/Medium/Hard, and the behavioural buckets tested
// `streak >= 7`. None of those exist on Codeforces, and HackerRank and CodeChef
// publish no difficulty split at all — so a page keyed to one platform could
// only ever be right about one platform.
//
// A LENS is the platform the page is currently reporting on, plus "all". This
// module maps a lens to the numbers that platform actually publishes, so the UI
// asks a question instead of assuming an answer. Nothing here fetches; it is
// pure, so it can be reasoned about and tested without a database.

import type { CohortPlatform, CohortPlatformStat } from "@/lib/classrooms.functions";
import { BUCKETS, filterBucket, type BucketId, type StudentRow } from "@/lib/buckets";

export const ALL_LENS = "all";

export type Lens = {
  id: string;
  name: string;
  /** 'solved' | 'rating' | 'score'. Meaningless for the "all" lens. */
  rank_metric: string;
  isAll: boolean;
};

export function lensFor(platformId: string | undefined, platforms: CohortPlatform[]): Lens {
  if (!platformId || platformId === ALL_LENS) {
    return { id: ALL_LENS, name: "All platforms", rank_metric: "score", isAll: true };
  }
  const p = platforms.find((x) => x.id === platformId);
  // An unknown id falls back to "all" rather than rendering an empty page. A
  // stale bookmark or a platform removed from the cohort should degrade to the
  // overview, not to nothing.
  if (!p) return { id: ALL_LENS, name: "All platforms", rank_metric: "score", isAll: true };
  return { id: p.id, name: p.name, rank_metric: p.rank_metric || "solved", isAll: false };
}

/** Human label for whatever this lens ranks on. */
export function metricLabel(rank_metric: string): string {
  if (rank_metric === "rating") return "Rating";
  if (rank_metric === "score") return "Score";
  return "Solved";
}

/**
 * The value a platform is RANKED on.
 *
 * Was duplicated in cohort-platform-report.tsx and cohort-overall.tsx. Showing
 * problems-solved for Codeforces would be actively misleading — a 1900-rated
 * competitor with 300 solves is stronger than a 900-rated one with 900 — so the
 * platform's own rank_metric decides, never the caller.
 */
export function lensMetric(
  stat: CohortPlatformStat | undefined,
  rank_metric: string,
): number | null {
  if (!stat) return null;
  if (rank_metric === "rating") return stat.rating;
  if (rank_metric === "score") return stat.platform_score ?? stat.total_solved;
  return stat.total_solved;
}

// ────────────────────────────────────────────────────────────────────────────
// Bands — the filter chips
// ────────────────────────────────────────────────────────────────────────────

export type Band = {
  id: string;
  label: string;
  /** Counts and filters are both driven by this, so they cannot disagree. */
  test: (v: number) => boolean;
};

/**
 * Distribution bands for a platform's metric.
 *
 * Rating cut points follow the Codeforces tiers competitive programmers already
 * think in, so a band label means something to the student being measured rather
 * than being an arbitrary quintile.
 */
export function bandsFor(rank_metric: string, values: number[]): Band[] {
  if (rank_metric === "rating") {
    return [
      { id: "r1", label: "< 1200", test: (v) => v < 1200 },
      { id: "r2", label: "1200–1399", test: (v) => v >= 1200 && v < 1400 },
      { id: "r3", label: "1400–1599", test: (v) => v >= 1400 && v < 1600 },
      { id: "r4", label: "1600–1899", test: (v) => v >= 1600 && v < 1900 },
      { id: "r5", label: "1900–2099", test: (v) => v >= 1900 && v < 2100 },
      { id: "r6", label: "2100+", test: (v) => v >= 2100 },
    ];
  }
  if (rank_metric === "solved") {
    return [
      { id: "s0", label: "0", test: (v) => v === 0 },
      { id: "s1", label: "1–50", test: (v) => v >= 1 && v <= 50 },
      { id: "s2", label: "51–200", test: (v) => v > 50 && v <= 200 },
      { id: "s3", label: "201–500", test: (v) => v > 200 && v <= 500 },
      { id: "s4", label: "500+", test: (v) => v > 500 },
    ];
  }
  // 'score' has no published scale, so bands come from the cohort itself.
  // Quartiles over the observed values keep the buckets useful whatever the
  // platform's arbitrary units happen to be.
  const sorted = [...values].sort((a, b) => a - b);
  const at = (f: number) => sorted[Math.floor(sorted.length * f)] ?? 0;
  const q1 = at(0.25);
  const q2 = at(0.5);
  const q3 = at(0.75);
  return [
    { id: "q1", label: `≤ ${Math.round(q1).toLocaleString()}`, test: (v) => v <= q1 },
    { id: "q2", label: `${Math.round(q1)}–${Math.round(q2)}`, test: (v) => v > q1 && v <= q2 },
    { id: "q3", label: `${Math.round(q2)}–${Math.round(q3)}`, test: (v) => v > q2 && v <= q3 },
    { id: "q4", label: `> ${Math.round(q3).toLocaleString()}`, test: (v) => v > q3 },
  ];
}

/** One filter chip: an id, a label and a live count. */
export type LensFilter = { id: string; label: string; count: number };

export type LensFilterSet = {
  /** 'buckets' when these are the behavioural buckets, 'bands' otherwise. */
  kind: "buckets" | "bands";
  filters: LensFilter[];
};

/**
 * The chips this lens should offer, with counts.
 *
 * LeetCode keeps its nine behavioural buckets — they are real, they are what
 * faculty already work from, and they are the reason the feature exists. Every
 * other platform gets metric bands instead, because those buckets read
 * `today`/`week`/`streak` off the LeetCode submission calendar, which no other
 * platform publishes. Synthesising them elsewhere would be inventing data rather
 * than reporting it.
 */
export function lensFilters(
  lens: Lens,
  rows: StudentRow[],
  statsByStudent: Map<string, Record<string, CohortPlatformStat>>,
): LensFilterSet {
  if (lens.isAll || lens.id === "leetcode") {
    return {
      kind: "buckets",
      filters: BUCKETS.map((b) => ({
        id: b.id,
        label: b.label,
        count: filterBucket(rows, b.id).length,
      })),
    };
  }

  const values = rows
    .map((r) => lensMetric(statsByStudent.get(r.id)?.[lens.id], lens.rank_metric))
    .filter((v): v is number => v !== null);

  const bands = bandsFor(lens.rank_metric, values);
  return {
    kind: "bands",
    filters: [
      { id: "all", label: "All", count: values.length },
      ...bands.map((b) => ({ id: b.id, label: b.label, count: values.filter(b.test).length })),
    ],
  };
}

/** Apply whichever filter kind this lens uses. Ids are disjoint across kinds. */
export function applyLensFilter(
  lens: Lens,
  rows: StudentRow[],
  statsByStudent: Map<string, Record<string, CohortPlatformStat>>,
  filterId: string,
): StudentRow[] {
  if (!filterId || filterId === "all") return rows;

  if (lens.isAll || lens.id === "leetcode") {
    // Guard the cast: a band id left in the URL after switching lenses must not
    // be handed to filterBucket, which would fall through its switch and return
    // undefined.
    if (!BUCKETS.some((b) => b.id === filterId)) return rows;
    return filterBucket(rows, filterId as BucketId);
  }

  const values = rows
    .map((r) => lensMetric(statsByStudent.get(r.id)?.[lens.id], lens.rank_metric))
    .filter((v): v is number => v !== null);
  const band = bandsFor(lens.rank_metric, values).find((b) => b.id === filterId);
  if (!band) return rows;

  return rows.filter((r) => {
    const v = lensMetric(statsByStudent.get(r.id)?.[lens.id], lens.rank_metric);
    return v !== null && band.test(v);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Stat cards
// ────────────────────────────────────────────────────────────────────────────

/** Four cards that are always on screen, plus the rest behind a disclosure. */
export type LensStatCards = { primary: LensStat[]; secondary: LensStat[] };

export type LensStat = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "easy" | "medium" | "hard";
};

export type LensStatInput = {
  lens: Lens;
  /** Every student in scope, so coverage has a denominator. */
  rows: StudentRow[];
  statsByStudent: Map<string, Record<string, CohortPlatformStat>>;
  almanacScoreOf?: (studentId: string) => number | null;
  /** Platforms in this cohort, for the "all" lens. */
  platforms: CohortPlatform[];
  /** Solved in the trailing window, from daily_snapshots. Null = no history. */
  windowSolved?: number | null;
  windowDays?: number;
  activeInWindow?: number | null;
  /** ISO date of the first snapshot, so "no history" never renders as 0. */
  firstSnapshotDate?: string | null;
};

const fmt = (n: number) => n.toLocaleString();

/**
 * Never render 0 when the real answer is "no history yet".
 *
 * Same rule performance.functions.ts follows and for the same reason: a panel
 * that shows `0 solved` when a platform has one day of data is reporting "no
 * activity" when the truth is "nothing to compare against". Opposite
 * conclusions, identical pixels.
 */
function windowValue(solved: number | null | undefined, since: string | null | undefined) {
  if (solved === null || solved === undefined) {
    return {
      value: "—",
      hint: since
        ? `collecting since ${new Date(since).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
        : "no history yet",
    };
  }
  return { value: fmt(solved), hint: null as string | null };
}

/**
 * The cards for this lens, split by importance.
 *
 * `primary` is ALWAYS four cards answering the same four questions whatever the
 * platform — how many students, how many are covered, how good are they, and
 * what changed recently. Keeping the shape fixed is the point: a row that swaps
 * length and meaning as you change lens cannot be compared across platforms,
 * and six-to-eight cards is what made the page unreadable.
 *
 * `secondary` is everything else, for a disclosure. Nothing is dropped — it just
 * stops competing with the roster for attention.
 */
export function lensStatCards(input: LensStatInput): LensStatCards {
  const {
    lens,
    rows,
    statsByStudent,
    almanacScoreOf,
    platforms,
    windowSolved,
    windowDays = 30,
    activeInWindow,
    firstSnapshotDate,
  } = input;

  const n = rows.length;
  const pct = (k: number) => (n > 0 ? `${Math.round((k / n) * 100)}%` : "—");
  const w = windowValue(windowSolved, firstSnapshotDate);

  if (lens.isAll) {
    const solvedAcross = rows.reduce((a, r) => {
      const per = statsByStudent.get(r.id) ?? {};
      return a + Object.values(per).reduce((s, p) => s + (p.total_solved ?? 0), 0);
    }, 0);

    const scores = almanacScoreOf
      ? rows.map((r) => almanacScoreOf(r.id)).filter((v): v is number => v !== null)
      : [];
    const onAny = rows.filter((r) => Object.keys(statsByStudent.get(r.id) ?? {}).length > 0).length;

    return {
      primary: [
        { label: "Students", value: fmt(n), hint: `${onAny} on a platform` },
        { label: "Coverage", value: pct(onAny), hint: `${n - onAny} not tracked` },
        {
          label: "Avg Score",
          value: scores.length
            ? fmt(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
            : "—",
          hint: scores.length ? `across ${scores.length} ranked` : "not ranked yet",
          tone: "primary",
        },
        {
          label: `Solved (${windowDays}d)`,
          value: w.value,
          hint: w.hint ?? `${activeInWindow ?? 0} students active`,
        },
      ],
      secondary: [
        // Accented to match "Avg Score": the cohort's lifetime output is the
        // other headline number people look for, and rendering it plain made it
        // read as an afterthought next to the score it is derived from.
        {
          label: "Solved (all time)",
          value: fmt(solvedAcross),
          hint: "every platform combined",
          tone: "primary",
        },
        {
          label: "Platforms tracked",
          value: fmt(platforms.length),
          hint: platforms.length ? platforms.map((p) => p.name).join(", ") : "none yet",
        },
      ],
    };
  }

  const stats = rows
    .map((r) => statsByStudent.get(r.id)?.[lens.id])
    .filter((s): s is CohortPlatformStat => !!s);
  const values = stats
    .map((s) => lensMetric(s, lens.rank_metric))
    .filter((v): v is number => v !== null);

  const onPlatform = stats.length;
  const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const top = values.length ? Math.max(...values) : null;
  const solved = stats.reduce((a, s) => a + (s.total_solved ?? 0), 0);
  const label = metricLabel(lens.rank_metric);

  const primary: LensStat[] = [
    { label: "Students", value: fmt(n), hint: `${onPlatform} on ${lens.name}` },
    {
      label: "Coverage",
      value: n > 0 ? `${Math.round((onPlatform / n) * 100)}%` : "—",
      hint: n - onPlatform > 0 ? `${n - onPlatform} without a handle` : "everyone",
    },
    {
      label: `Avg ${label}`,
      value: avg !== null ? fmt(avg) : "—",
      hint: `across ${values.length} students`,
      tone: "primary",
    },
    { label: `Solved (${windowDays}d)`, value: w.value, hint: w.hint ?? "on this platform" },
  ];

  const secondary: LensStat[] = [
    {
      label: `Top ${label}`,
      value: top !== null ? fmt(Math.round(top)) : "—",
      hint: "best in cohort",
    },
    // Same accent as the all-platforms lens, so switching platform doesn't
    // change which cards are emphasised.
    {
      label: "Solved (all time)",
      value: solved ? fmt(solved) : "—",
      hint: "combined",
      tone: "primary",
    },
    {
      label: `Active (${windowDays}d)`,
      value: activeInWindow !== null && activeInWindow !== undefined ? fmt(activeInWindow) : "—",
      hint: onPlatform > 0 ? `${pct(activeInWindow ?? 0)} of cohort` : undefined,
    },
  ];

  if (lens.rank_metric === "rating") {
    const maxRatings = stats
      .map((s) => s.max_rating)
      .filter((v): v is number => typeof v === "number");
    if (maxRatings.length) {
      secondary.push({
        label: "Peak rating",
        value: fmt(Math.round(Math.max(...maxRatings))),
        hint: "highest ever reached",
      });
    }
  }

  if (lens.rank_metric === "solved" && onPlatform > 0) {
    secondary.push({
      label: "Avg / student",
      value: fmt(Math.round(solved / onPlatform)),
      hint: "lifetime",
    });
  }

  return { primary, secondary };
}

/**
 * Whether this lens can draw a difficulty donut.
 *
 * Read off the DATA, not a hardcoded platform list: HackerRank and CodeChef put
 * their whole count in `unrated_solved` because they publish no split, and a
 * donut of one grey slice says less than nothing. A platform that starts
 * reporting difficulty later then works with no code change here.
 */
export function hasDifficultySplit(d: {
  easy: number | null;
  medium: number | null;
  hard: number | null;
}): boolean {
  return (d.easy ?? 0) + (d.medium ?? 0) + (d.hard ?? 0) > 0;
}
