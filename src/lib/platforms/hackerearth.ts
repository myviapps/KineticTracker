// HackerEarth adapter.
//
// The thinnest adapter in the set, and deliberately so. HackerEarth's profile at
// /@{handle} is a JS-rendered app: the served HTML is a shell, so `request()`
// cannot see a single one of the numbers on the page. Everything here goes
// through `renderedRequest()`, which hands back the DOM a browser would have
// built.
//
// What we take from it: Problems Solved, Points, Contest Ratings and Solutions
// Submitted — the four stat cards the profile renders.
//
// `platforms.notes` for this row says "Mostly JS-rendered; only a weak
// problems-solved count is reliably extractable". The first half is exactly
// right and is why this file exists. The second half turned out to understate
// it: a live render shows four clean value/label cards, not one weak number.
//
// Targeted regex rather than a DOM library, matching codechef.ts: four values
// out of one document does not justify parsing ~300KB through cheerio.
//
// ── VERIFICATION STATUS ───────────────────────────────────────────────────────
// VERIFIED on 2026-08-04 against a live render of /@sarthak through the local
// Scrapling sidecar. Confirmed then:
//   · the served HTML really is a shell — "Solved" appears 0 times in a plain
//     GET (142KB) and 2 times after rendering (313KB)
//   · all four extractors return the values shown on the page
//   · the ORIGINAL wait-for selectors were absent from the document entirely,
//     so every fetch would have hit the render timeout. Fixed; see WAIT_FOR.
//
// EXTENDED on 2026-08-05 against /@vijaydmb (a real account) and an invented
// handle, which closed the two gaps left open above:
//   · `looksLikeProfile` was WRONG on a real profile — both of its signals test
//     the stripped body, and the handle only ever appears inside a <script>.
//     A live account with four populated cards was reported not_found. Rewritten
//     against the <title>; see the note at its site.
//   · the not-found path never reached the adapter at all: HackerEarth 404s at
//     the HTTP level, but WAIT_FOR cannot match a 404 shell, so the render hit
//     its wall and came back as `throttle` — retryable, so a typo would be
//     retried at 26s a go forever. Fixed in the sidecar, which now falls back to
//     a selector-free render and reports the real status.
// Both paths are now exercised: vijaydmb and sarthak parse, an invented handle
// returns not_found.
//
// The failure mode remains safe by construction: a wrong regex yields
// parse_error (loud, "the adapter is broken"), never a silent zero.

import { parseAssert } from "./http";
import { hasRenderer, renderedRequest } from "./render";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
} from "./types";

const ID = "hackerearth";
const PROFILE = "https://www.hackerearth.com/@{h}";

/**
 * What the renderer must see before it hands the page back.
 *
 * VERIFIED against a live render of /@sarthak on 2026-08-04.
 *
 * The original guesses — `[class*='problems-solved']` and `.profile-container`
 * — do not exist on the page at all. Neither would ever have resolved, so every
 * fetch would have burned the full render timeout and come back as a renderer
 * failure: the worst kind of bug, because the adapter looks broken while the
 * extraction underneath it is fine.
 *
 * HackerEarth's profile is Tailwind-built with no semantic class names, so the
 * readiness signal has to be a utility class. `.text-xl.font-semibold` is the
 * stat-card VALUE node — it cannot exist before the numbers have arrived, which
 * is exactly the property a wait selector needs. Waiting on a shell node
 * (header, nav, #root) is the classic mistake: it resolves the moment the bundle
 * mounts and hands back a skeleton that parses as "no solved count".
 */
const WAIT_FOR = "div.text-xl.font-semibold";

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

/**
 * Drop <script> and <style> before matching anything.
 *
 * Rendered SPA output carries the app's own state blobs inline, full of ids,
 * timestamps and version numbers. A label-then-number regex will happily seize
 * one of those, and a plausible-looking wrong number is exactly the outcome the
 * parse_error contract exists to prevent.
 */
function stripNoise(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/**
 * Reject values that cannot be a solve count.
 *
 * The regexes below scan across markup, so a near-miss can return a year, a
 * user id or a pixel width. Returning null here routes those into parse_error
 * instead of writing 20260808 into total_solved.
 */
function saneCount(n: number | null): number | null {
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || n > 100_000) return null;
  return n;
}

/**
 * Three shapes for one number, tried strongest first.
 *
 * VERIFIED: pattern 2 is the one that fires. HackerEarth renders each stat as a
 * card with the VALUE above the LABEL:
 *
 *   <div class="text-xl font-semibold leading-none">1</div>
 *   <div class="text-sm text-muted-foreground ...">Problems Solved</div>
 *
 * Patterns 1 and 3 were checked against the same render and correctly matched
 * nothing — they are kept because they cost one regex each and cover the two
 * layouts HackerEarth might move to, and a wrong-but-plausible number is the
 * failure this file exists to avoid.
 *
 * All three require the digits to sit in a TEXT position (`>123<`) rather than
 * anywhere within 160 characters. That constraint is what stops the match
 * drifting into an attribute like data-user-id="48213".
 */
const SOLVED_PATTERNS: RegExp[] = [
  // Label above/left of the value: "Problems Solved</div><div>412</div>"
  /Problems?\s*Solved[\s\S]{0,160}?>\s*([\d,]+)\s*</i,
  // Value above the label — HackerEarth's actual layout. This is the live one.
  />\s*([\d,]+)\s*<[\s\S]{0,160}?Problems?\s*Solved/i,
  // Last resort: a flat sentence, "412 problems solved", with no markup between.
  /([\d,]+)\s+problems?\s+solved/i,
];

/**
 * The other three stat cards, which the platforms seed did not know about.
 *
 * Its note says HackerEarth yields "only a weak problems-solved count". A live
 * render shows four cards — Points, Contest Ratings, Problems Solved and
 * Solutions Submitted — so the platform is meaningfully richer than recorded.
 *
 * Same value-above-label shape as above, so the same regex with a different
 * label. Each is independent: a missing card yields null and is simply not
 * written, rather than failing the fetch.
 */
const CARD = (label: string) => new RegExp(String.raw`>\s*([\d,]+)\s*<[\s\S]{0,160}?${label}`, "i");

const POINTS_PATTERN = CARD("Points");
const RATING_PATTERN = CARD("Contest\\s*Ratings?");
const SUBMISSIONS_PATTERN = CARD("Solutions\\s*Submitted");

export const hackerearthAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    // Without the sidecar, renderedRequest falls back to a plain GET and returns
    // the un-hydrated shell — which contains no solve count, so extraction would
    // fail and report parse_error for every single student. That reads as "the
    // adapter is broken" and would page whoever owns the alert. Say the true
    // thing instead, and say it as `throttle` so the circuit breaker parks the
    // platform rather than counting failures against innocent handles. Wording
    // mirrors render.ts's own no-renderer error.
    if (!hasRenderer()) {
      throw new PlatformError(
        "throttle",
        0,
        "HackerEarth needs browser rendering — set SCRAPLING_URL to enable it",
        ID,
      );
    }

    const raw = await renderedRequest(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
      waitFor: WAIT_FOR,
      // MEASURED, and the selector alone is not enough.
      //
      // The stat cards live in a carousel that fills in progressively, so
      // WAIT_FOR resolves the moment the FIRST card mounts — which in testing was
      // "Points", with Problems Solved still absent. A fetch that returned in
      // 3.2s produced a 305KB page with one of four cards, and the adapter would
      // have raised parse_error on a page that was merely caught mid-render.
      //
      // 6s was the shortest settle that returned all four cards on 3/3 runs;
      // 4s did not. The selector still earns its place as a floor — it fails fast
      // if the page never renders at all, instead of always paying the 6s.
      settleMs: 6_000,
      platformId: ID,
    });
    const html = stripNoise(raw);

    /*
      Does this look like a profile at all?

      MEASURED on 2026-08-05 against the real account /@vijaydmb, which BOTH of
      the original signals got wrong:

        class="...profile..."   false — the page is Tailwind-built and has no
                                        semantic class names anywhere
        contains "@vijaydmb"    false AFTER stripping — the handle occurs exactly
                                        once in the whole document, inside a
                                        Next.js `self.__next_f.push(...)`
                                        <script>, which stripNoise removes

      So a live profile with four populated stat cards was reported as
      `not_found` — the worst possible verdict, because the worker never retries
      it and the student silently drops off the platform for good.

      The <title> is the signal that actually holds: it sits in <head>, survives
      stripping, and reads "<Name> | Developer Profile on HackerEarth". The stat
      cards are the second, independent signal — a page carrying them is a
      profile whatever the title says.
    */
    const title = pick(html, /<title[^>]*>\s*([^<]+?)\s*<\/title>/i) ?? "";
    const looksLikeProfile =
      /Developer\s+Profile\s+on\s+HackerEarth/i.test(title) ||
      /Problems?\s*Solved|Solutions?\s*Submitted/i.test(html);

    if (!looksLikeProfile) {
      // Only NOW is a not-found marker trustworthy. Checked in this order on
      // purpose: a bio or a feed entry could contain the words "page not found",
      // and mis-reading that as not_found permanently retires a working handle
      // (the worker never retries not_found).
      if (/page\s+not\s+found|does\s+not\s+exist|user\s+not\s+found|404/i.test(html)) {
        throw new PlatformError("not_found", 200, `No HackerEarth user "${handle}"`, ID);
      }
      // Rendered, but recognisably neither a profile nor a 404. Far more likely
      // the wait selector fired early or the layout moved than that the student
      // is imaginary — so blame ourselves, loudly.
      throw new PlatformError(
        "parse_error",
        200,
        `${ID}: page rendered but does not look like a profile — the layout has probably changed`,
        ID,
        raw.slice(0, 500),
      );
    }

    let solved: number | null = null;
    let matchedPattern = -1;
    for (let i = 0; i < SOLVED_PATTERNS.length; i++) {
      const v = saneCount(num(pick(html, SOLVED_PATTERNS[i])));
      if (v !== null) {
        solved = v;
        matchedPattern = i;
        break;
      }
    }

    // The whole point of this adapter. A profile that rendered but yielded no
    // count means our regexes no longer match the markup — NOT a student who has
    // solved nothing. Writing 0 here would quietly reclassify an active student
    // as inactive across the leaderboard, which is the exact failure types.ts
    // singles out.
    parseAssert(solved !== null, ID, "problems-solved count");

    /*
      The other three cards. Each is optional and independent: a card that is
      absent yields null and is simply not written, so one missing stat can never
      fail a fetch that already has the number this adapter exists for.

      `points` and `rating` are read as counts and then allowed to be 0 — unlike
      solved, a genuine zero here is normal and meaningful for a new account.
    */
    const points = saneCount(num(pick(html, POINTS_PATTERN)));
    const rating = saneCount(num(pick(html, RATING_PATTERN)));
    const submissions = saneCount(num(pick(html, SUBMISSIONS_PATTERN)));

    return {
      // HackerEarth publishes no difficulty split, so the count goes to
      // unratedSolved as well and the composite weights it via weight_unrated —
      // same treatment as CodeChef and HackerRank.
      totalSolved: solved,
      unratedSolved: solved,

      // `?? undefined` rather than passing null through: null would tell the
      // worker to WRITE an empty column, undefined tells it to leave the column
      // alone. For a card that simply was not on the page, the second is true.
      platformScore: points ?? undefined,
      // HackerEarth's own label is "Contest Ratings". Written to `rating` so it
      // lands in the same column every rating platform uses, even though the
      // platform is ranked on solved.
      rating: rating ?? undefined,

      data: submissions !== null ? { solutions_submitted: submissions } : undefined,

      /*
        The one identity field HackerEarth does give up, from the <title>:
        "Vijay Sundar Nagamalla | Developer Profile on HackerEarth".

        Taken only when the suffix matches, and left `undefined` otherwise —
        echoing a half-parsed title back as a student's name would be worse than
        showing the handle, which is what the UI falls back to.
      */
      displayName: /\|\s*Developer\s+Profile\s+on\s+HackerEarth/i.test(title)
        ? title.split("|")[0]?.trim() || undefined
        : undefined,

      // Deliberately absent: avatar, country, ranks, streak, contestsAttended.
      // Leaving them `undefined` means the worker never writes those columns, so
      // a future version that CAN read them is a pure addition rather than an
      // unpicking of bad data.

      // Only the low-confidence flat-sentence match is flagged. Not blanket-true:
      // fetch_status='partial' overrides the freshness TTL (see
      // 20260808000009_partial_retry.sql), so an always-partial platform would
      // re-render every account on every job run — an expensive sidecar call per
      // student, forever, for data that is already as complete as it will get.
      partial: matchedPattern === SOLVED_PATTERNS.length - 1,
    };
  },

  // No verifyHandle. There is no cheaper existence check: the only thing that
  // distinguishes a real handle from a fake one is the rendered page itself, and
  // an un-rendered status probe has not been verified to 404 rather than serve
  // the same app shell for both. The contract falls back to fetchProfile, which
  // is the identical request we would have had to make anyway.

  // No fetchBatch: HackerEarth has no multi-handle endpoint, and rendering is
  // strictly one page at a time.
};

export const __test = { pick, stripNoise, saneCount, SOLVED_PATTERNS, WAIT_FOR };
