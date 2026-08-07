// Codeforces adapter — the only platform here with a documented public API.
//
// Three things make this adapter more involved than the others, all verified
// against live responses rather than taken from the docs:
//
// 1. There is NO total-solved field. It has to be derived by counting distinct
//    OK verdicts across the user's whole submission history — 1.3MB for a heavy
//    user. So this adapter syncs INCREMENTALLY: it remembers the newest
//    submission it has seen and the set of problems already solved, and each
//    later refresh reads only what is above that mark.
//
// 2. Difficulty comes from problemset.problems (11,006 of 11,320 problems carry
//    a rating), fetched ONCE globally and cached, then joined locally. Bucketing
//    therefore costs nothing per student.
//
// 3. user.info fails ATOMICALLY. One bad handle in a batch of a hundred returns
//    HTTP 400 for the entire request, naming the offender. Unhandled, a single
//    typo would block the whole college — so the batch path parses the offender
//    out, records it as not_found, and retries with the remainder.

import { getJson, sleep, hasBudget, remainingMs } from "./http";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
  type BatchItem,
} from "./types";

const ID = "codeforces";
const API = "https://codeforces.com/api";

/** Documented limit is 1 request / 2s; anything faster earns a 403. */
const CALL_GAP_MS = 2_100;

/**
 * Difficulty buckets. Codeforces problem ratings run 800–3500; these cut points
 * are the community's usual div2-A/div2-C/div1 split and keep a CF "easy"
 * roughly comparable to a LeetCode easy, which is what the weighted composite
 * assumes.
 */
function bucketOf(rating: number | null): "easy" | "medium" | "hard" | "unrated" {
  if (rating === null) return "unrated";
  if (rating < 1200) return "easy";
  if (rating < 1900) return "medium";
  return "hard";
}

// ── problemset cache ────────────────────────────────────────────────────────
// 2.2MB and identical for every student, so it is fetched at most once per
// process. A serverless invocation pays for it on the first student of the
// chunk and every subsequent one reads memory.

type ProblemKey = string; // `${contestId}${index}`
let problemRatings: Map<ProblemKey, number> | null = null;
let problemRatingsAt = 0;
const PROBLEMSET_TTL_MS = 6 * 60 * 60 * 1000;

async function getProblemRatings(ctx: FetchContext): Promise<Map<ProblemKey, number>> {
  if (problemRatings && Date.now() - problemRatingsAt < PROBLEMSET_TTL_MS) {
    return problemRatings;
  }
  // Needs real headroom: ~2.2MB and ~1.5s. If the chunk cannot afford it we
  // carry on with whatever is cached (possibly nothing) rather than failing the
  // student — a missing difficulty split is a degraded row, not a broken one.
  if (!hasBudget(ctx.deadline, 8_000)) return problemRatings ?? new Map();

  try {
    const json = await getJson<{
      status: string;
      result?: { problems: { contestId?: number; index?: string; rating?: number }[] };
    }>(`${API}/problemset.problems`, ctx, { timeoutMs: 20_000, platformId: ID });

    const map = new Map<ProblemKey, number>();
    for (const p of json.result?.problems ?? []) {
      if (p.contestId != null && p.index && typeof p.rating === "number") {
        map.set(`${p.contestId}${p.index}`, p.rating);
      }
    }
    if (map.size > 0) {
      problemRatings = map;
      problemRatingsAt = Date.now();
    }
    return problemRatings ?? new Map();
  } catch {
    // Degrade rather than fail: everything lands in `unrated`.
    return problemRatings ?? new Map();
  }
}

// ── API helpers ─────────────────────────────────────────────────────────────

type CfEnvelope<T> = { status: string; comment?: string; result?: T };

type CfUser = {
  handle: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  contribution?: number;
  friendOfCount?: number;
  avatar?: string;
  titlePhoto?: string;
  registrationTimeSeconds?: number;
  lastOnlineTimeSeconds?: number;
};

type CfRatingChange = {
  contestId: number;
  contestName: string;
  rank: number;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
};

type CfSubmission = {
  id: number;
  verdict?: string;
  creationTimeSeconds: number;
  programmingLanguage?: string;
  problem: { contestId?: number; index?: string; name?: string; rating?: number; tags?: string[] };
};

/** Codeforces puts its human-readable reason in `comment`, including on a 400. */
function cfComment(body: string | undefined): string | null {
  if (!body) return null;
  try {
    return (JSON.parse(body) as CfEnvelope<unknown>).comment ?? null;
  } catch {
    return null;
  }
}

/** Codeforces answers 200-with-status-FAILED as well as 400, so check both. */
async function cfGet<T>(path: string, ctx: FetchContext): Promise<T> {
  let json: CfEnvelope<T>;
  try {
    json = await getJson<CfEnvelope<T>>(`${API}${path}`, ctx, {
      platformId: ID,
      // 400 is how Codeforces reports an unknown handle, and its body carries
      // the detail we need, so it must not be swallowed as a generic failure.
      treat404AsNotFound: false,
    });
  } catch (e) {
    if (e instanceof PlatformError && e.status === 400) {
      // PROPAGATE THE COMMENT VERBATIM. It reads
      // "handles: User with handle X not found", and the batch path parses X out
      // of it to evict exactly one handle. Replacing it with a tidy generic
      // message is what previously turned one typo into a hundred failures.
      const comment = cfComment(e.body) ?? "Codeforces handle not found";
      throw new PlatformError("not_found", 400, comment, ID, e.body);
    }
    throw e;
  }

  if (json.status !== "OK") {
    const comment = json.comment ?? "unknown error";
    if (/not found/i.test(comment)) throw new PlatformError("not_found", 400, comment, ID);
    if (/limit exceeded/i.test(comment)) throw new PlatformError("throttle", 429, comment, ID);
    throw new PlatformError("fail", 400, comment, ID);
  }
  if (json.result === undefined) {
    throw new PlatformError("parse_error", 200, "Codeforces returned OK with no result", ID);
  }
  return json.result;
}

/** Pull the offending handle out of "handles: User with handle X not found". */
function offendingHandle(message: string): string | null {
  return message.match(/handle\s+(\S+?)\s+not found/i)?.[1] ?? null;
}

// ── incremental solved-set sync ─────────────────────────────────────────────

/**
 * Two cursors, not one — and the distinction is the whole correctness story.
 *
 * user.status returns NEWEST FIRST, so a walk that runs out of budget after
 * three pages has seen the most recent submissions and none of the older ones.
 * Recording the newest id as "done" would make the next run stop immediately at
 * that mark and never reach page four, silently freezing the backfill forever —
 * which is exactly why ten of twelve demo accounts sat at null.
 *
 *   newestId     high-water mark. Advanced ONLY when a walk finishes, because
 *                only then is everything above it genuinely accounted for.
 *   backfillFrom the paging offset an unfinished walk stopped at, so the next
 *                run resumes there instead of restarting.
 */
type CfCursor = {
  newestId?: number;
  solved?: ProblemKey[];
  backfillFrom?: number;
};

const PAGE = 1000;
const MAX_PAGES = 12; // 12k submissions is far beyond any student; a guard, not a limit

async function syncSolved(
  handle: string,
  ctx: FetchContext,
  prev: CfCursor,
): Promise<{ solved: Set<ProblemKey>; cursor: CfCursor; truncated: boolean }> {
  const solved = new Set<ProblemKey>(prev.solved ?? []);
  const stopAt = prev.newestId ?? 0;
  // Resume an interrupted backfill rather than re-reading pages already paid for.
  let from = prev.backfillFrom ?? 1;
  let maxSeenId = 0;
  let truncated = false;
  let completed = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (!hasBudget(ctx.deadline, 6_000)) {
      truncated = true;
      break;
    }

    const subs = await cfGet<CfSubmission[]>(
      `/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${PAGE}`,
      ctx,
    );
    if (subs.length === 0) {
      completed = true;
      break;
    }

    let reachedCursor = false;
    for (const s of subs) {
      if (s.id > maxSeenId) maxSeenId = s.id;
      // Newest-first, so the first id at or below the mark means everything
      // above it was counted on a previous completed run.
      if (s.id <= stopAt) {
        reachedCursor = true;
        break;
      }
      if (s.verdict === "OK" && s.problem?.contestId != null && s.problem.index) {
        solved.add(`${s.problem.contestId}${s.problem.index}`);
      }
    }

    if (reachedCursor || subs.length < PAGE) {
      completed = true;
      break;
    }
    from += PAGE;
    if (page < MAX_PAGES - 1) await sleep(ctx.callGapMs ?? CALL_GAP_MS);
  }

  const cursor: CfCursor = completed
    ? { newestId: Math.max(stopAt, maxSeenId), solved: [...solved] }
    : // Unfinished: keep the OLD high-water mark so the next run still walks the
      // pages below, and remember where to resume.
      { newestId: stopAt || undefined, solved: [...solved], backfillFrom: from };

  return { solved, cursor, truncated: truncated || !completed };
}

function buildProfile(
  u: CfUser,
  solved: Set<ProblemKey>,
  ratings: Map<ProblemKey, number>,
  extras: {
    contests?: CfRatingChange[];
    cursor?: CfCursor;
    truncated: boolean;
    solvedKnown: boolean;
  },
): NormalizedProfile {
  let easy = 0;
  let medium = 0;
  let hard = 0;
  let unrated = 0;
  for (const key of solved) {
    switch (bucketOf(ratings.get(key) ?? null)) {
      case "easy":
        easy++;
        break;
      case "medium":
        medium++;
        break;
      case "hard":
        hard++;
        break;
      default:
        unrated++;
        break;
    }
  }

  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  const contests = extras.contests ?? [];

  return {
    displayName: name || u.handle,
    avatar: u.titlePhoto ?? u.avatar ?? null,
    country: u.country ?? null,

    // undefined, not 0, when the solved set was never fetched — the worker
    // skips undefined fields, so a rating-only refresh cannot blank a real count.
    totalSolved: extras.solvedKnown ? solved.size : undefined,
    easySolved: extras.solvedKnown ? easy : undefined,
    mediumSolved: extras.solvedKnown ? medium : undefined,
    hardSolved: extras.solvedKnown ? hard : undefined,
    unratedSolved: extras.solvedKnown ? unrated : undefined,

    rating: num(u.rating),
    maxRating: num(u.maxRating),
    // user.info.rank is a TITLE ("legendary grandmaster"), not a position, so it
    // must not go in global_rank — sorting by it would be meaningless.
    globalRank: null,
    contestsAttended: contests.length || undefined,

    data: {
      cf_rank_title: u.rank ?? null,
      cf_max_rank_title: u.maxRank ?? null,
      organization: u.organization ?? null,
      city: u.city ?? null,
      contribution: u.contribution ?? null,
      friend_of_count: u.friendOfCount ?? null,
      registered_at: u.registrationTimeSeconds
        ? new Date(u.registrationTimeSeconds * 1000).toISOString()
        : null,
      rating_history: contests.map((c) => ({
        contest_id: c.contestId,
        name: c.contestName,
        rank: c.rank,
        old_rating: c.oldRating,
        new_rating: c.newRating,
        at: new Date(c.ratingUpdateTimeSeconds * 1000).toISOString(),
      })),
      solved_truncated: extras.truncated,
    },
    partial: extras.truncated || !extras.solvedKnown,
    // Persisted even when truncated: partial progress is the entire point of a
    // resumable backfill.
    syncCursor: extras.cursor as Record<string, unknown> | undefined,
  };
}

// ── adapter ─────────────────────────────────────────────────────────────────

export const codeforcesAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    const users = await cfGet<CfUser[]>(
      `/user.info?handles=${encodeURIComponent(handle)}&checkHistoricRating=true`,
      ctx,
    );
    if (!users.length) throw new PlatformError("not_found", 400, "No such handle", ID);

    const ratings = await getProblemRatings(ctx);

    let contests: CfRatingChange[] = [];
    if (hasBudget(ctx.deadline, 6_000)) {
      await sleep(ctx.callGapMs ?? CALL_GAP_MS);
      try {
        contests = await cfGet<CfRatingChange[]>(
          `/user.rating?handle=${encodeURIComponent(handle)}`,
          ctx,
        );
      } catch {
        /* unrated users legitimately have no history — non-fatal */
      }
    }

    const prev = (ctx.syncCursor ?? {}) as CfCursor;
    let solvedKnown = false;
    let sync: { solved: Set<ProblemKey>; cursor: CfCursor; truncated: boolean } = {
      solved: new Set<ProblemKey>(prev.solved ?? []),
      cursor: prev,
      truncated: false,
    };

    if (hasBudget(ctx.deadline, 8_000)) {
      await sleep(ctx.callGapMs ?? CALL_GAP_MS);
      sync = await syncSolved(handle, ctx, prev);
      solvedKnown = true;
    } else if (prev.solved) {
      // Nothing new fetched, but the stored set is still true — report it rather
      // than pretending we know nothing.
      solvedKnown = true;
      sync.truncated = true;
    }

    return buildProfile(users[0], sync.solved, ratings, {
      contests,
      cursor: sync.cursor,
      truncated: sync.truncated,
      solvedKnown,
    });
  },

  /** One request for the whole batch — no submission history, so it stays cheap. */
  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const users = await cfGet<CfUser[]>(`/user.info?handles=${encodeURIComponent(handle)}`, ctx);
      const u = users[0];
      if (!u) return { ok: false, reason: "No such Codeforces user" };
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      return { ok: true, displayName: name || u.handle };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such Codeforces user" };
      }
      throw e;
    }
  },

  /**
   * user.info takes ~100 semicolon-separated handles, so identity and rating for
   * an entire cohort cost one request. Solved counts still need a per-handle
   * history walk, which is where the remaining budget goes.
   */
  async fetchBatch(
    items: BatchItem[],
    ctx: FetchContext = {},
  ): Promise<Map<string, NormalizedProfile | PlatformError>> {
    const out = new Map<string, NormalizedProfile | PlatformError>();
    if (items.length === 0) return out;

    const handles = items.map((i) => i.handle);
    // Each handle's stored progress, so a walk that ran out of budget last run
    // picks up where it stopped instead of starting over.
    const cursorOf = new Map(
      items.map((i) => [i.handle.toLowerCase(), (i.syncCursor ?? {}) as CfCursor]),
    );

    // Resolve identity first, evicting bad handles one at a time. Bounded by the
    // number of handles so a pathological batch cannot loop forever.
    let pending = [...handles];
    let users: CfUser[] = [];
    for (let attempt = 0; attempt <= handles.length && pending.length > 0; attempt++) {
      try {
        users = await cfGet<CfUser[]>(
          `/user.info?handles=${pending.map(encodeURIComponent).join(";")}&checkHistoricRating=true`,
          ctx,
        );
        break;
      } catch (e) {
        if (!(e instanceof PlatformError) || e.kind !== "not_found") {
          // A throttle or network failure is not any single handle's fault.
          for (const h of pending) out.set(h, e as PlatformError);
          return out;
        }
        const bad = offendingHandle(e.message);
        if (!bad) {
          // Cannot tell which handle broke it, so fall back to one-by-one rather
          // than discarding the whole batch.
          for (const h of pending) {
            out.set(h, new PlatformError("fail", 400, "Batch rejected; retry individually", ID));
          }
          return out;
        }
        out.set(
          bad,
          new PlatformError("not_found", 400, `Codeforces handle "${bad}" not found`, ID),
        );
        pending = pending.filter((h) => h.toLowerCase() !== bad.toLowerCase());
        await sleep(ctx.callGapMs ?? CALL_GAP_MS);
      }
    }

    const ratings = await getProblemRatings(ctx);
    const byHandle = new Map(users.map((u) => [u.handle.toLowerCase(), u]));

    for (const h of pending) {
      const u = byHandle.get(h.toLowerCase());
      if (!u) {
        out.set(h, new PlatformError("not_found", 400, "Not returned by user.info", ID));
        continue;
      }

      // Identity + rating are already in hand. Solved counts are best-effort:
      // when the budget runs out the student still gets a correct rating row and
      // the history walk resumes next chunk from the stored cursor.
      const prev = cursorOf.get(h.toLowerCase()) ?? {};

      if (!hasBudget(ctx.deadline, 8_000)) {
        // No budget to walk history. Emit identity + rating and carry the
        // EXISTING cursor through untouched — discarding it would throw away
        // every page already paid for on previous runs, which is how ten of
        // twelve accounts stayed stuck at null.
        const known = new Set<ProblemKey>(prev.solved ?? []);
        out.set(
          h,
          buildProfile(u, known, ratings, {
            cursor: prev,
            truncated: true,
            solvedKnown: known.size > 0,
          }),
        );
        continue;
      }

      try {
        await sleep(ctx.callGapMs ?? CALL_GAP_MS);
        const sync = await syncSolved(h, ctx, prev);
        out.set(
          h,
          buildProfile(u, sync.solved, ratings, {
            cursor: sync.cursor,
            truncated: sync.truncated,
            solvedKnown: true,
          }),
        );
      } catch (e) {
        out.set(h, e instanceof PlatformError ? e : new PlatformError("fail", 0, String(e), ID));
      }
    }

    return out;
  },
};

/** Test seam: reset the module-level problemset cache between fixture runs. */
export function __resetProblemsetCache() {
  problemRatings = null;
  problemRatingsAt = 0;
}

export const __test = { bucketOf, offendingHandle };
