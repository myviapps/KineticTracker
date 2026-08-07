// InterviewBit adapter.
//
// InterviewBit's profile at /profile/{handle} is a client-rendered React app —
// the served HTML holds no numbers at all, so this goes through
// `renderedRequest()` rather than `request()`.
//
// What the page gives us, and all it gives us:
//
//   platformScore — InterviewBit's own points total, the headline stat
//   globalRank    — position on the site-wide leaderboard
//   streak        — consecutive-day activity counter
//
// Note what is NOT here: a problems-solved count. InterviewBit's `rank_metric`
// in the platforms table is `solved`, but the profile does not surface a solve
// count anywhere we can attribute confidently — it shows per-topic progress
// bars, not a total. So totalSolved stays `undefined`, and the college ranking
// for this platform will have nothing to rank on until either the site exposes a
// total or someone decides the score is an acceptable proxy. That decision is
// not an adapter's to make silently, which is why nothing is written there. This
// matches `platforms.notes`: "Score/rank/streak only, JS-rendered."
//
// Targeted regex rather than a DOM library, matching codechef.ts.
//
// ── UNVERIFIED ────────────────────────────────────────────────────────────────
// Every selector and regex below is a GUESS. None has been run against a real
// rendered InterviewBit profile, because that needs the Scrapling sidecar
// (SCRAPLING_URL) which is not configured yet. Each guess is marked at its site.
// The extraction is written so a wrong guess produces parse_error — a loud "the
// adapter is broken" — and never a plausible-looking wrong number.

import { parseAssert } from "./http";
import { hasRenderer, renderedRequest } from "./render";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
} from "./types";

const ID = "interviewbit";
const PROFILE = "https://www.interviewbit.com/profile/{h}";

/**
 * What the renderer must see before it hands the page back.
 *
 * UNVERIFIED — the selector list is a guess.
 *
 * Waiting on the app root or a nav element would be useless: those exist the
 * moment React mounts, seconds before the profile API call resolves, and the
 * renderer would return a skeleton whose missing numbers we would then report as
 * parse_error. Both alternatives below can only appear after the profile payload
 * has been applied:
 *
 *   [class*='profile-score'] — the element carrying the headline score, i.e.
 *                              the exact value this adapter asserts on. Waiting
 *                              for the datum itself is the strongest possible
 *                              readiness signal. Substring match so a hashed or
 *                              suffixed CSS-module class still hits.
 *   .profile-container       — fallback: the profile card as a whole, in case
 *                              the score element is named something else.
 *
 * A comma list resolves when EITHER matches, so a wrong first guess is
 * survivable.
 */
const WAIT_FOR = "[class*='profile-score'], .profile-container";

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

/** First pattern that yields a sane number wins; null when none does. */
function pickFirst(html: string, patterns: RegExp[], max: number): number | null {
  for (const re of patterns) {
    const v = sane(num(pick(html, re)), max);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Drop <script> and <style> before matching.
 *
 * A rendered React page ships its hydration state inline. Label-then-number
 * regexes will cheerfully match an id or a timestamp out of that blob, and a
 * wrong-but-believable score is precisely what the parse_error contract exists
 * to prevent.
 */
function stripNoise(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/**
 * Reject values that cannot be the stat we were looking for.
 *
 * The regexes scan across markup, so a near-miss can return a year, an id or a
 * pixel width. Returning null routes that into parse_error (or into `partial`
 * for the optional fields) rather than persisting nonsense.
 */
function sane(n: number | null, max: number): number | null {
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

// UNVERIFIED — guesses at InterviewBit's stat markup.
//
// Each label gets a label-first and a value-first variant because stat cards
// disagree about which comes first, and both require the digits to sit in a TEXT
// position (`>123<`) rather than anywhere within the window. That constraint is
// what stops a match drifting into an attribute such as data-user-id="48213",
// the usual way this style of regex goes wrong.

const SCORE_PATTERNS: RegExp[] = [
  /(?:Total\s*)?Score[\s\S]{0,160}?>\s*([\d,]+)\s*</i,
  />\s*([\d,]+)\s*<[\s\S]{0,160}?(?:Total\s*)?Score\b/i,
];

const RANK_PATTERNS: RegExp[] = [
  // `\b` around Rank so "Ranking", "Ranked" and similar do not anchor a match.
  // `#?` because leaderboard positions are often rendered as "#1,204".
  /Global\s*Rank\b[\s\S]{0,160}?>\s*#?\s*([\d,]+)\s*</i,
  />\s*#?\s*([\d,]+)\s*<[\s\S]{0,160}?Global\s*Rank\b/i,
  // Bare "Rank" only after the qualified forms fail — it is far likelier to
  // collide with an unrelated label.
  /\bRank\b[\s\S]{0,160}?>\s*#?\s*([\d,]+)\s*</i,
];

const STREAK_PATTERNS: RegExp[] = [
  /(?:Current\s*|Day\s*)?Streak\b[\s\S]{0,160}?>\s*([\d,]+)\s*</i,
  />\s*([\d,]+)\s*<[\s\S]{0,160}?(?:Current\s*|Day\s*)?Streak\b/i,
  /([\d,]+)\s*-?\s*day\s+streak/i,
];

export const interviewbitAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    // With no sidecar, renderedRequest degrades to a plain GET and returns the
    // empty React shell — every student would then fail extraction and be
    // reported as parse_error, i.e. "the adapter is broken", when the actual
    // fault is a missing service. Raise the true cause, as `throttle` so the
    // circuit breaker parks the platform instead of charging failures to
    // innocent handles. Wording mirrors render.ts's own no-renderer error.
    if (!hasRenderer()) {
      throw new PlatformError(
        "throttle",
        0,
        "InterviewBit needs browser rendering — set SCRAPLING_URL to enable it",
        ID,
      );
    }

    const raw = await renderedRequest(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
      waitFor: WAIT_FOR,
      platformId: ID,
    });
    const html = stripNoise(raw);

    // UNVERIFIED — is this a profile at all? Two independent weak signals: a
    // `profile`-ish class name, or the handle echoed back in the page text
    // (InterviewBit renders the username in the profile header).
    const looksLikeProfile =
      /class="[^"]*profile[^"]*"/i.test(html) || html.toLowerCase().includes(handle.toLowerCase());

    if (!looksLikeProfile) {
      // Not-found markers are only trusted once we know this is NOT a profile.
      // Checking them first would let the phrase appearing anywhere on a real
      // profile permanently retire a working handle — the worker never retries
      // not_found.
      if (/page\s+not\s+found|does\s+not\s+exist|user\s+not\s+found|404/i.test(html)) {
        throw new PlatformError("not_found", 200, `No InterviewBit user "${handle}"`, ID);
      }
      throw new PlatformError(
        "parse_error",
        200,
        `${ID}: page rendered but does not look like a profile — the layout has probably changed`,
        ID,
        raw.slice(0, 500),
      );
    }

    // Bounds are per-field: IB scores run to five figures, ranks to seven on a
    // site with millions of accounts, and a streak beyond a few years is
    // certainly a mis-match rather than a very dedicated student.
    const platformScore = pickFirst(html, SCORE_PATTERNS, 10_000_000);
    const globalRank = pickFirst(html, RANK_PATTERNS, 100_000_000);
    const streak = pickFirst(html, STREAK_PATTERNS, 10_000);

    // The score is the one field every InterviewBit profile shows, including a
    // brand-new account (which renders a literal 0 — that still matches, and 0
    // is a true answer). Its ABSENCE therefore means the markup moved, not that
    // the student is inactive. Failing loudly here is the whole difference
    // between an alert on a broken adapter and silently zeroing a cohort.
    parseAssert(platformScore !== null, ID, "profile score");

    return {
      platformScore,
      globalRank: globalRank ?? undefined,
      streak: streak ?? undefined,

      // Deliberately absent: totalSolved and the difficulty split (see the
      // header note), plus displayName, avatar, country, rating and
      // contestsAttended — none has a trustworthy anchor on this page. Leaving
      // them `undefined` keeps the worker from writing those columns at all, so
      // adding them later is a pure gain rather than a correction.

      // Rank is expected on every profile, so losing it means something moved
      // and the row is worth revisiting — the codechef.ts precedent
      // (`partial: solved === null`) applied to the field that matters here.
      //
      // Streak is deliberately NOT part of this condition. It is plausibly
      // hidden for a dormant account, and fetch_status='partial' overrides the
      // freshness TTL (see 20260808000009_partial_retry.sql) — so folding a
      // legitimately-absent streak in would re-render those accounts on every
      // job run, forever, at one sidecar page-load each.
      partial: globalRank === null,
    };
  },

  // No verifyHandle. There is no lighter existence check available: the only
  // thing separating a real handle from a fake one is the rendered page, and an
  // un-rendered status probe has not been verified to 404 rather than return the
  // same SPA shell for both. The contract falls back to fetchProfile, which is
  // the same request we would have had to make regardless.

  // No fetchBatch: InterviewBit has no multi-handle endpoint, and the renderer
  // handles exactly one page per call.
};

export const __test = {
  pick,
  pickFirst,
  stripNoise,
  sane,
  SCORE_PATTERNS,
  RANK_PATTERNS,
  STREAK_PATTERNS,
  WAIT_FOR,
};
