// AtCoder adapter.
//
// Two sources, and the split between them is the whole design:
//
//   atcoder.jp/users/{h}/history/json — first-party and authoritative. It is the
//     only endpoint here that can prove a handle exists, and it carries the full
//     contest history, from which rating, peak rating and contests attended are
//     all derived. There is no "user summary" JSON on atcoder.jp.
//   kenkoooo.com/.../user/ac_rank    — a third-party mirror answering "how many
//     distinct problems has this user had accepted, and where does that place
//     them" in one tiny response. AtCoder publishes no solved count in any
//     machine-readable form of its own, so this is the only route to one.
//
// Because the second source is somebody else's mirror, it is treated as strictly
// optional: a kenkoooo outage degrades the row to partial and never fails a
// student whose rating we have already paid for.
//
// Difficulty is deliberately absent. AtCoder assigns no official per-problem
// difficulty at all; the community estimates kenkoooo serves arrive as a ~4.4MB
// metadata dump, which is far too much to pull per refresh for a split nobody has
// asked for. easy/medium/hardSolved therefore stay undefined — NOT zero — so the
// worker leaves those columns untouched rather than writing three convincing
// lies. The whole count goes to unratedSolved, which is what the composite
// weights for platforms with no split.
//
// No fetchBatch: neither endpoint accepts more than one handle.
//
// AtCoder asks automated clients to identify themselves, and kenkoooo's README
// asks the same, so both calls send a descriptive User-Agent. Passing it through
// the headers option overrides the browser-ish default in http.ts, which exists
// for the Cloudflare-fronted platforms and is the opposite of what is wanted here.

import { getJson, request, sleep, hasBudget, parseAssert } from "./http";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "atcoder";
const HISTORY = "https://atcoder.jp/users/{h}/history/json";
const AC_RANK = "https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user={h}";

/** Mirrors platforms.base_cooldown_ms for this row; ctx.callGapMs overrides it. */
const CALL_GAP_MS = 1_200;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "KeniticTrackerHub/1.0 (college coding-progress tracker; one refresh per student per day)",
};

// ── history/json ────────────────────────────────────────────────────────────

type AcHistoryEntry = {
  IsRated: boolean;
  Place: number;
  OldRating: number;
  NewRating: number;
  Performance?: number;
  ContestScreenName?: string;
  ContestName: string;
  EndTime: string;
};

/**
 * Field-by-field shape check, applied to EVERY entry.
 *
 * The failure this guards against is specific: if AtCoder renames or drops
 * NewRating, a permissive read would hand back a student whose rating quietly
 * became null and whose contest count became zero, and that reads as a real
 * regression rather than a broken adapter. Anything unrecognised must surface as
 * parse_error instead.
 */
function isHistoryEntry(v: unknown): v is AcHistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.IsRated === "boolean" &&
    typeof e.NewRating === "number" &&
    typeof e.OldRating === "number" &&
    typeof e.ContestName === "string" &&
    typeof e.EndTime === "string"
  );
}

/** EndTime is JST-offset ISO ("2019-03-30T22:40:00+09:00"); 0 sorts a junk value first. */
function endMs(e: AcHistoryEntry): number {
  const ms = Date.parse(e.EndTime);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * AtCoder's colour band, derived rather than fetched.
 *
 * It is a published pure function of rating, so computing it costs nothing while
 * scraping it would cost a whole extra HTML page — the same reasoning that made
 * CodeChef's stars a derivation. Kept at the official eight bands; the
 * silver/gold shades above 3200 are a community convention, not AtCoder's.
 */
function colourFor(rating: number | null): string | null {
  if (rating === null) return null;
  if (rating < 400) return "grey";
  if (rating < 800) return "brown";
  if (rating < 1200) return "green";
  if (rating < 1600) return "cyan";
  if (rating < 2000) return "blue";
  if (rating < 2400) return "yellow";
  if (rating < 2800) return "orange";
  return "red";
}

async function fetchHistory(handle: string, ctx: FetchContext): Promise<AcHistoryEntry[]> {
  const raw = await getJson<unknown>(HISTORY.replace("{h}", encodeURIComponent(handle)), ctx, {
    headers: HEADERS,
    platformId: ID,
    timeoutMs: 20_000,
  });

  // A top-level array is the contract. Anything else means the endpoint moved,
  // which is an adapter problem and must never be read as "no contests".
  parseAssert(Array.isArray(raw), ID, "contest history array from history/json");

  const entries = raw.filter(isHistoryEntry);
  parseAssert(
    entries.length === raw.length,
    ID,
    "recognisable history entries (IsRated/OldRating/NewRating/ContestName/EndTime)",
  );

  // Chronological order is undocumented, so it is imposed rather than assumed:
  // taking the array's last element for "current rating" would silently record a
  // stale number the day AtCoder reverses it.
  return entries.sort((a, b) => endMs(a) - endMs(b));
}

// ── kenkoooo ac_rank ────────────────────────────────────────────────────────

type AcRank = { count: number; rank: number | null };

/** Returns null when the mirror gives back something we cannot use. */
async function fetchAcRank(handle: string, ctx: FetchContext): Promise<AcRank | null> {
  const raw = await getJson<unknown>(AC_RANK.replace("{h}", encodeURIComponent(handle)), ctx, {
    headers: HEADERS,
    platformId: ID,
    // Short on purpose: it is a few dozen bytes of enrichment, and a stalled
    // mirror must not eat budget the remaining students need.
    timeoutMs: 8_000,
  });

  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const count = num(r.count);
  if (count === null) return null;

  /*
    VERIFIED 0-based on 2026-08-04, so the +1 is required rather than assumed.

    Proof: /v3/ac_ranking?from=0&to=1 names Rubikun (7923 solved) as the top
    solver, and /v3/user/ac_rank?user=Rubikun returns rank 0. Without the offset
    the strongest user on the platform would render as "#0 globally", and
    everyone else would be one place better than they are.

    Anything unparseable stays null rather than becoming a fabricated rank.
  */
  const rank = num(r.rank);
  return { count, rank: rank === null ? null : rank + 1 };
}

export const atcoderAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    /*
      MEASURED against the live API on 2026-08-04, and it does NOT behave the way
      this adapter originally assumed:

        real handle  history/json -> 200, 141 entries
        fake handle  history/json -> 200 with `[]`      ← NOT a 404
        real handle  ac_rank      -> {"count":1057,"rank":4388}
        fake handle  ac_rank      -> 404

      So history/json cannot settle existence on its own. An empty array means
      BOTH "registered user who has never sat a rated contest" and "no such
      user", and the original code read it as the former — which would have filed
      every mistyped handle as a real student with nothing to show, silently and
      permanently, because nothing downstream ever revisits a handle that
      returned successfully.

      kenkoooo is the only endpoint that distinguishes them, so the two are read
      together below.
    */
    const entries = await fetchHistory(handle, ctx);

    const rated = entries.filter((e) => e.IsRated);
    const latest = rated.length ? rated[rated.length - 1] : null;

    let ac: AcRank | null = null;
    let acNotFound = false;
    if (hasBudget(ctx.deadline, 6_000)) {
      await sleep(ctx.callGapMs ?? CALL_GAP_MS);
      try {
        ac = await fetchAcRank(handle, ctx);
      } catch (e) {
        // A 404 is recorded rather than swallowed — it is half of the existence
        // test above. Every other failure (slow mirror, budget abort) stays
        // swallowed: the rating row is already in hand and correct, and throwing
        // it away because a third-party mirror was unavailable would turn a good
        // refresh into a failure counted against the handle.
        if (e instanceof PlatformError && e.kind === "not_found") acNotFound = true;
      }
    }

    /*
      Neither endpoint knows this handle. kenkoooo only indexes users who have
      had a submission ACCEPTED, so its 404 alone is not proof — a registered
      beginner is legitimately absent from it. Combined with an empty rating
      history, though, there is nothing on AtCoder to find.

      Raised as not_found, which the worker never retries: this needs a human to
      correct the handle, and retrying a typo only spends the rate-limit budget
      the valid handles need.
    */
    if (acNotFound && entries.length === 0) {
      throw new PlatformError(
        "not_found",
        404,
        `No AtCoder user "${handle}" — no rated contests and unknown to kenkoooo`,
        ID,
      );
    }

    const rating = latest ? latest.NewRating : null;

    return {
      // Neither endpoint returns a human name — AtCoder shows one only on the
      // rendered profile page — so this stays unreported rather than echoing the
      // input handle back as though the platform had confirmed it.
      totalSolved: ac ? ac.count : undefined,
      // No difficulty split exists, so the whole count is unrated rather than
      // guessed into buckets; easy/medium/hardSolved are left undefined so the
      // worker never writes them.
      unratedSolved: ac ? ac.count : undefined,

      rating,
      maxRating: rated.length ? Math.max(...rated.map((e) => e.NewRating)) : null,
      globalRank: ac ? ac.rank : undefined,
      // A plain number, not `|| undefined` as on Codeforces: there the history
      // call is best-effort and a zero might mean "not fetched", whereas here it
      // is the primary call, so zero rated contests is a fact worth storing.
      contestsAttended: rated.length,

      data: {
        colour: colourFor(rating),
        // Provenance matters for this one: it comes from a mirror, so a staff
        // member comparing it against atcoder.jp should know where it came from.
        solved_source: ac ? "kenkoooo.com/atcoder" : null,
        unrated_contests: entries.length - rated.length,
        /**
         * Shaped for panel-kit's toRatingHistory(), which reads new_rating, name,
         * at and rank. Unrated participations are excluded deliberately: they
         * leave the rating unchanged and would draw flat duplicate points on the
         * chart while implying the contest counted.
         */
        rating_history: rated.map((e) => ({
          new_rating: e.NewRating,
          old_rating: e.OldRating,
          at: endMs(e) ? new Date(endMs(e)).toISOString() : e.EndTime,
          name: e.ContestName,
          rank: num(e.Place),
          performance: num(e.Performance),
        })),
      },
      // The solved count is the only optional piece; without it the row is a
      // complete rating record with one field missing, not a failure.
      partial: ac === null,
    };
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    // ac_rank first because it is the cheapest thing either host serves. A
    // non-zero count is proof on its own: kenkoooo only lists users who have had
    // a submission accepted on AtCoder.
    try {
      const ac = await fetchAcRank(handle, ctx);
      if (ac && ac.count > 0) return { ok: true, displayName: handle };
    } catch {
      /* fall through — the mirror's opinion is never the final word */
    }

    // Everything else is ambiguous: a zero count, a missing kenkoooo record and a
    // mirror outage all look the same from here, and a genuine AtCoder account
    // that has registered but never solved anything sits in exactly that gap.
    // Rejecting it would tell staff a valid handle was a typo, so the first-party
    // endpoint gets the last word.
    await sleep(ctx.callGapMs ?? CALL_GAP_MS);
    try {
      await request(HISTORY.replace("{h}", encodeURIComponent(handle)), ctx, {
        headers: HEADERS,
        platformId: ID,
      });
      // AtCoder exposes no display name on either JSON endpoint, so the handle
      // itself is all there is to show back.
      return { ok: true, displayName: handle };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such AtCoder user" };
      }
      throw e;
    }
  },
};

export const __test = { colourFor, isHistoryEntry, endMs };
