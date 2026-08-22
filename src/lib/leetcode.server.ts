// LeetCode public GraphQL scraper. Server-only helper.
import { currentStreak } from "./date-buckets";

const LC_URL = "https://leetcode.com/graphql";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; Almanac/1.0; +https://almanac.example)",
  Referer: "https://leetcode.com/",
};

export class LeetCodeError extends Error {
  kind: "throttle" | "fail" | "budget";
  status: number;
  constructor(kind: "throttle" | "fail" | "budget", status: number, message: string) {
    super(message);
    this.name = "LeetCodeError";
    this.kind = kind;
    this.status = status;
  }
}

const CALL_TIMEOUT_MS = 12_000;
/** Below this much remaining budget a call cannot meaningfully complete. */
const MIN_CALL_MS = 1_500;

/**
 * Epoch-ms ceiling for all work in the current chunk, or `undefined` for
 * "unbounded" (interactive single-student refresh).
 *
 * Every network call clamps its own timeout to whatever is left, so a slow
 * student can no longer push a batch past the caller's budget. That overrun
 * is what pushed chunks past Vercel's 60s maxDuration and turned the pump
 * workflow red.
 */
export type Deadline = number | undefined;

function remainingMs(deadline: Deadline): number {
  return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - Date.now();
}

// LeetCode's public GraphQL has no documented limit but throttles around
// ~30 req/min per IP. We retry on 429/5xx with exponential backoff and
// serialize the per-user calls (see fetchLeetCodeProfile below).
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  deadline: Deadline,
  attempt = 0,
): Promise<T> {
  const left = remainingMs(deadline);
  if (left < MIN_CALL_MS) {
    throw new LeetCodeError("budget", 0, "Chunk budget exhausted before request");
  }
  // Clamping to the remaining budget is what makes overrun structurally
  // impossible rather than merely unlikely: the signal aborts an in-flight
  // fetch, not just a not-yet-started one.
  const timeout = Math.min(CALL_TIMEOUT_MS, left);

  let res: Response;
  try {
    res = await fetch(LC_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: unknown) {
    const isAbort = e instanceof DOMException && e.name === "TimeoutError";
    const status = isAbort ? 408 : 0;
    // A timeout that fired because the BUDGET ran out is not the student's
    // fault, and must not be reported as one — see scrapeStudentById, which
    // skips the consecutive_failures penalty for this kind.
    if (isAbort && remainingMs(deadline) < MIN_CALL_MS) {
      throw new LeetCodeError("budget", status, "Chunk budget exhausted mid-request");
    }
    if (isAbort && attempt < 3) {
      const wait = 1500 * Math.pow(2, attempt);
      if (remainingMs(deadline) < wait + MIN_CALL_MS) {
        throw new LeetCodeError("budget", status, "Chunk budget exhausted before retry");
      }
      await new Promise((r) => setTimeout(r, wait));
      return gql<T>(query, variables, deadline, attempt + 1);
    }
    throw new LeetCodeError(
      "fail",
      status,
      isAbort
        ? "Request timed out"
        : `Network error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3)
      throw new LeetCodeError("throttle", res.status, `LeetCode HTTP ${res.status} after retries`);
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const wait = retryAfter > 0 ? retryAfter * 1000 : 1500 * Math.pow(2, attempt);
    // Don't burn the tail of the budget sleeping on a retry we can't afford.
    if (remainingMs(deadline) < wait + MIN_CALL_MS) {
      throw new LeetCodeError(
        "throttle",
        res.status,
        `LeetCode HTTP ${res.status} — no budget left to retry`,
      );
    }
    await new Promise((r) => setTimeout(r, wait));
    return gql<T>(query, variables, deadline, attempt + 1);
  }
  if (!res.ok) {
    const isCloudflare = res.status === 403 || res.status === 503;
    throw new LeetCodeError(
      isCloudflare ? "throttle" : "fail",
      res.status,
      `LeetCode HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length)
    throw new LeetCodeError("fail", res.status, json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new LeetCodeError("fail", res.status, "Empty response from LeetCode");
  return json.data;
}

const PROFILE_QUERY = /* GraphQL */ `
  query userPublicProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        realName
        userAvatar
        countryName
        reputation
        ranking
      }
      submitStats: submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
      submitStatsAll: submitStats {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
        totalSubmissionNum {
          difficulty
          count
          submissions
        }
      }
      languageProblemCount {
        languageName
        problemsSolved
      }
      tagProblemCounts {
        advanced {
          tagName
          problemsSolved
        }
        intermediate {
          tagName
          problemsSolved
        }
        fundamental {
          tagName
          problemsSolved
        }
      }
      badges {
        id
        displayName
        icon
        creationDate
      }
    }
    allQuestionsCount {
      difficulty
      count
    }
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
      totalParticipants
      topPercentage
    }
  }
`;

const CALENDAR_QUERY = /* GraphQL */ `
  query userProfileCalendar($username: String!, $year: Int) {
    matchedUser(username: $username) {
      userCalendar(year: $year) {
        activeYears
        streak
        totalActiveDays
        submissionCalendar
      }
    }
  }
`;

const RECENT_QUERY = /* GraphQL */ `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
      lang
    }
  }
`;

export type LcSubmit = { difficulty: string; count: number; submissions: number };

export type LcProfileData = {
  matchedUser: {
    username: string;
    profile: {
      realName: string | null;
      userAvatar: string | null;
      countryName: string | null;
      reputation: number | null;
      ranking: number | null;
    };
    submitStats: { acSubmissionNum: LcSubmit[] };
    submitStatsAll: {
      acSubmissionNum: LcSubmit[];
      totalSubmissionNum: LcSubmit[];
    };
    languageProblemCount: { languageName: string; problemsSolved: number }[];
    tagProblemCounts: {
      advanced: { tagName: string; problemsSolved: number }[];
      intermediate: { tagName: string; problemsSolved: number }[];
      fundamental: { tagName: string; problemsSolved: number }[];
    };
    badges: { id: string; displayName: string; icon: string; creationDate: string }[];
  } | null;
  allQuestionsCount: { difficulty: string; count: number }[];
  userContestRanking: {
    attendedContestsCount: number;
    rating: number;
    globalRanking: number;
    totalParticipants: number;
    topPercentage: number;
  } | null;
};

export type LcCalendarData = {
  matchedUser: {
    userCalendar: {
      activeYears: number[];
      streak: number;
      totalActiveDays: number;
      submissionCalendar: string; // JSON string of unix-day -> count
    };
  } | null;
};

export type LcRecentData = {
  recentAcSubmissionList: {
    id: string;
    title: string;
    titleSlug: string;
    timestamp: string;
    lang: string;
  }[];
};

export type ParsedProfile = {
  realName: string | null;
  avatar: string | null;
  country: string | null;
  reputation: number;
  ranking: number | null;

  totalSolved: number;
  totalQuestions: number;
  easySolved: number;
  easyTotal: number;
  mediumSolved: number;
  mediumTotal: number;
  hardSolved: number;
  hardTotal: number;
  acceptanceRate: number | null;

  /** Undefined when NO calendar year could be fetched, so the stored value is
   *  left alone rather than being overwritten with a 0 that is not true. */
  streak?: number;
  totalActiveDays?: number;
  submissionCalendar: Record<string, number>;

  contestRating: number | null;
  contestGlobalRanking: number | null;
  contestsAttended: number | null;
  contestTopPercentage: number | null;

  languageStats: { language: string; solved: number }[];
  tagStats: {
    fundamental: { tag: string; solved: number }[];
    intermediate: { tag: string; solved: number }[];
    advanced: { tag: string; solved: number }[];
  };
  badges: { id: string; name: string; icon: string; date: string }[];

  recent: { title: string; titleSlug: string; lang: string; submittedAt: string }[];
};

function pickCount(list: LcSubmit[], difficulty: string): number {
  return list.find((x) => x.difficulty === difficulty)?.count ?? 0;
}
function pickTotal(list: { difficulty: string; count: number }[], difficulty: string): number {
  return list.find((x) => x.difficulty === difficulty)?.count ?? 0;
}

export async function fetchLeetCodeProfile(
  username: string,
  deadline?: Deadline,
): Promise<ParsedProfile> {
  // Serialize the 3 calls (no Promise.all) with a small gap between them —
  // three parallel bursts per student was the fastest way to trip LeetCode's
  // per-IP throttle.
  const profile = await gql<LcProfileData>(PROFILE_QUERY, { username }, deadline);
  await new Promise((r) => setTimeout(r, 250));

  let calendar: LcCalendarData | null = null;
  let recent: LcRecentData | null = null;
  /*
    The profile call is the only required one. Calendar and recent submissions
    are already best-effort, so when the budget is spent we skip them outright
    rather than paying a doomed request — the student still gets full stats.

    TWO YEARS, not one. `userCalendar` is scoped to the year you ask for, so a
    single call could never see a streak that crosses New Year — every streak
    reset to 0 on 1 Jan, and the 53-week heatmap had its left third blank by
    construction. The previous year is fetched second and is the first thing
    dropped when the budget runs short, because the current year is what almost
    every reader needs.
  */
  const thisYear = new Date().getUTCFullYear();
  /** Submission days from every year we managed to fetch, merged. */
  const mergedCalendar: Record<string, number> = {};
  let anyCalendar = false;

  for (const year of [thisYear, thisYear - 1]) {
    if (remainingMs(deadline) < MIN_CALL_MS) break;
    try {
      const c = await gql<LcCalendarData>(CALENDAR_QUERY, { username, year }, deadline);
      const uc = c?.matchedUser?.userCalendar;
      if (uc) {
        anyCalendar = true;
        // Only the CURRENT year's envelope is kept: totalActiveDays is a
        // per-year figure, and taking last year's would be a different question.
        if (year === thisYear) calendar = c;
        if (uc.submissionCalendar) {
          for (const [day, n] of Object.entries(
            JSON.parse(uc.submissionCalendar) as Record<string, number>,
          )) {
            mergedCalendar[day] = (mergedCalendar[day] ?? 0) + n;
          }
        }
      }
    } catch {
      /* calendar may be private or unavailable — non-fatal */
    }
    // Outside the try so an empty or failed year still pays the gap. A `continue`
    // here would fire the next request back to back, which is the one thing
    // these sleeps exist to prevent.
    await new Promise((r) => setTimeout(r, 250));
  }
  if (remainingMs(deadline) >= MIN_CALL_MS) {
    try {
      recent = await gql<LcRecentData>(RECENT_QUERY, { username, limit: 20 }, deadline);
    } catch {
      /* recent submissions may be unavailable — non-fatal */
    }
  }

  if (!profile.matchedUser) throw new Error(`LeetCode user "${username}" not found`);

  const mu = profile.matchedUser;
  const ac = mu.submitStatsAll.acSubmissionNum;
  const tot = mu.submitStatsAll.totalSubmissionNum;
  const all = profile.allQuestionsCount;

  const totalSolved = pickCount(ac, "All");
  // From `ac`, not `tot`. Both sides used to read totalSubmissionNum filtered
  // on the same "All" bucket, so the ratio was always exactly 1 and every
  // profile in the app reported 100% acceptance.
  const totalAcSubs = ac.find((x) => x.difficulty === "All")?.submissions ?? 0;
  const totalAllSubs = tot.reduce((s, x) => (x.difficulty === "All" ? s + x.submissions : s), 0);
  const acceptanceRate =
    totalAllSubs > 0 ? Math.round((totalAcSubs / totalAllSubs) * 100 * 10) / 10 : null;

  const cal = calendar?.matchedUser?.userCalendar;
  const submissionCalendar = mergedCalendar;

  return {
    realName: mu.profile.realName,
    avatar: mu.profile.userAvatar,
    country: mu.profile.countryName,
    reputation: mu.profile.reputation ?? 0,
    ranking: mu.profile.ranking ?? null,

    totalSolved,
    totalQuestions: pickTotal(all, "All"),
    easySolved: pickCount(ac, "Easy"),
    easyTotal: pickTotal(all, "Easy"),
    mediumSolved: pickCount(ac, "Medium"),
    mediumTotal: pickTotal(all, "Medium"),
    hardSolved: pickCount(ac, "Hard"),
    hardTotal: pickTotal(all, "Hard"),
    acceptanceRate,

    /*
      OUR number, not LeetCode's, and `undefined` rather than 0 when no calendar
      arrived at all.

      Two separate bugs lived on this line. It read `cal?.streak ?? 0`, so a
      scrape that ran out of budget — the calendar call is best-effort and
      skipped first — wrote 0 straight over a real 40-day streak, because
      definedColumns() only skips `undefined`. And LeetCode's own field is
      year-scoped, so it reset every 1 Jan. currentStreak() over the merged
      two-year calendar answers both.
    */
    streak: anyCalendar ? currentStreak(submissionCalendar) : undefined,
    totalActiveDays: cal?.totalActiveDays,
    submissionCalendar,

    contestRating: profile.userContestRanking?.rating ?? null,
    contestGlobalRanking: profile.userContestRanking?.globalRanking ?? null,
    contestsAttended: profile.userContestRanking?.attendedContestsCount ?? null,
    contestTopPercentage: profile.userContestRanking?.topPercentage ?? null,

    languageStats: mu.languageProblemCount.map((l) => ({
      language: l.languageName,
      solved: l.problemsSolved,
    })),
    tagStats: {
      fundamental: mu.tagProblemCounts.fundamental.map((t) => ({
        tag: t.tagName,
        solved: t.problemsSolved,
      })),
      intermediate: mu.tagProblemCounts.intermediate.map((t) => ({
        tag: t.tagName,
        solved: t.problemsSolved,
      })),
      advanced: mu.tagProblemCounts.advanced.map((t) => ({
        tag: t.tagName,
        solved: t.problemsSolved,
      })),
    },
    badges: mu.badges.map((b) => ({
      id: b.id,
      name: b.displayName,
      icon: b.icon,
      date: b.creationDate,
    })),
    recent: (recent?.recentAcSubmissionList ?? []).map((r) => ({
      title: r.title,
      titleSlug: r.titleSlug,
      lang: r.lang,
      submittedAt: new Date(Number(r.timestamp) * 1000).toISOString(),
    })),
  };
}

// helper: sum calendar between two dates (inclusive)
export function sumCalendarRange(
  cal: Record<string, number>,
  startUnix: number,
  endUnix: number,
): number {
  let sum = 0;
  for (const [k, v] of Object.entries(cal)) {
    const t = Number(k);
    if (t >= startUnix && t <= endUnix) sum += v;
  }
  return sum;
}
