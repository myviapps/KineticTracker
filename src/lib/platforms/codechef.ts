// CodeChef adapter.
//
// No API and no embedded state object — everything comes out of the rendered
// page. Two things make that tolerable:
//
//   * the full rating history is an inline `var all_rating = [...]` JS array, so
//     the contest graph is real JSON rather than something scraped off an SVG;
//   * the handful of numbers we need sit next to distinctive, long-lived class
//     names (.rating-number, .rating-star, .rating-ranks).
//
// Targeted regex rather than a DOM library, deliberately: the fields are few and
// anchored to class names, so cheerio would add a dependency and a full parse of
// a ~180KB document to extract six values. Every extraction goes through
// parseAssert, so a redesign raises parse_error instead of quietly returning
// zero — which is the failure mode that would otherwise wipe a cohort's history.

import { request, parseAssert } from "./http";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "codechef";
const PROFILE = "https://www.codechef.com/users/{h}";

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

/**
 * Stars are a pure function of rating on CodeChef, so DERIVE them rather than
 * scrape them. The markup parse returned 1 star for a 3355-rated (7-star)
 * account — the glyph run is split across elements — and a wrong number is worse
 * than a computed one when the mapping is published and stable.
 */
function starsFromRating(rating: number | null): number | null {
  if (rating === null) return null;
  if (rating < 1400) return 1;
  if (rating < 1600) return 2;
  if (rating < 1800) return 3;
  if (rating < 2000) return 4;
  if (rating < 2200) return 5;
  if (rating < 2500) return 6;
  return 7;
}

/** The inline rating history: `var all_rating = [ {...}, ... ];` */
function parseRatingHistory(
  html: string,
): { code: string; name: string; rating: number; rank: number; end: string }[] {
  const raw = html.match(/var\s+all_rating\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Record<string, unknown>[];
    return arr.map((c) => ({
      code: String(c.code ?? ""),
      name: String(c.name ?? ""),
      rating: Number(c.rating ?? 0),
      rank: Number(c.rank ?? 0),
      end: String(c.end_date ?? c.getdate ?? ""),
    }));
  } catch {
    return [];
  }
}

export const codechefAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    const res = await request(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
      platformId: ID,
      timeoutMs: 20_000,
    });
    const raw = res.body;

    /*
      Strip <style> and <script> before matching ANYTHING.

      MEASURED on 2026-08-04 against a real rated profile (vijaygupta, 930):
        · "rating-number" appears 4x in the stylesheet and 1x as an element, so
          a not-found check that accepts the string matched even for a user that
          does not exist
        · the contest-count regex matched inside a CSS rule and returned 12; the
          real figure on the page is 14
      Both are the same mistake — scanning a document that contains its own
      stylesheet — and both produced a confident wrong number rather than a
      failure anyone would notice.
    */
    const html = raw
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ");

    // CodeChef serves a 200 shell for unknown users, so absence of the profile
    // container is the not-found signal rather than the status code. Tested
    // against the stripped body so a stylesheet mention cannot vouch for a user.
    if (!/user-details|rating-number|userdetails-container/i.test(html)) {
      throw new PlatformError("not_found", 200, `No CodeChef user "${handle}"`, ID);
    }

    const rating = num(pick(html, /class="rating-number"[^>]*>\s*([\d,]+)/i));

    /*
      An UNRATED user has no rating element at all, and that is not a parse
      failure.

      MEASURED on 2026-08-04 against noted_world_33, a real account:
        · "rating-number" appears 4 times — every one of them inside <style>,
          zero as an actual element
        · the inline history is `var all_rating = [];`
        · the page shows "Contests (0)" and "Total Problems Solved: 5"

      The page parsed perfectly. The student has simply never competed, and
      CodeChef renders no rating widget for such a user.

      The old code asserted on the rating and reported
      "the page layout has probably changed" for every one of them. That is the
      wrong half of the types.ts distinction: not a silent zero, but a permanent
      loud failure that meant these students never got ANY data recorded — and
      on a college tracker, never-competed is the common case, not the edge one.

      SOLVED is the anchor instead. "Total Problems Solved: N" is unambiguous
      text, present on every profile including unrated ones, and it cannot be
      confused with a stylesheet. If that is readable the page was understood, so
      a missing rating is a fact about the student rather than about our parser.
    */
    const solvedAnchor = num(pick(html, /Total\s*Problems?\s*Solved\s*:\s*([\d,]+)/i));
    parseAssert(
      solvedAnchor !== null || rating !== null,
      ID,
      'profile body ("Total Problems Solved" and .rating-number both missing)',
    );

    const maxRating = num(pick(html, /Highest\s*Rating[\s\S]{0,120}?([\d,]{3,5})/i));

    /*
      Ranks come ONLY from inside the .rating-ranks block, and "Inactive" is a
      real answer.

      MEASURED against vijaygupta, whose block reads:
        <div class="rating-ranks"><ul class="inline-list">
          <li><a ...><strong> Inactive </strong></a> Global Rank</li>
          <li><a ...><strong> Inactive </strong></a> Country Rank</li>
        </ul></div>

      CodeChef prints "Inactive" instead of a number for anyone who has not
      competed recently. The previous fallbacks scanned up to 200 characters PAST
      the words "Global Rank" / "Country Rank" for any digits, so with no number
      to find they wandered into unrelated markup and returned 29176 and 4. A
      country rank of 4 for a 930-rated Div 4 player is obvious nonsense on
      sight — but nothing checks it, and it would have gone onto the profile and
      into the rankings as fact.

      Scoping to the block means "no number here" yields null, which is true,
      instead of a number from somewhere else, which is worse than nothing.
    */
    const ranksBlock = pick(html, /class="rating-ranks"([\s\S]{0,800}?)<\/div>/i) ?? "";
    const rankFor = (label: RegExp): number | null => {
      // Each <li> holds its value in <strong> BEFORE the label text.
      const li = ranksBlock.split(/<li[^>]*>/i).find((chunk) => label.test(chunk));
      if (!li) return null;
      const strong = li.match(/<strong[^>]*>\s*([\s\S]*?)\s*<\/strong>/i)?.[1] ?? "";
      // "Inactive" (or any non-numeric marker) is a genuine state, not a miss.
      return num(strong.replace(/<[^>]*>/g, "").trim());
    };
    const globalRank = rankFor(/Global\s*Rank/i);
    const countryRank = rankFor(/Country\s*Rank/i);
    /*
      VERIFIED shape: `<h3>Total Problems Solved: 5</h3>` inside
      <section class="rating-data-section problems-solved">.

      solvedAnchor above already matched that exactly. The looser patterns stay
      as fallbacks for the older layouts, but they are tried SECOND now — the
      first of them would happily match "Practice Paths (1)" style markup and
      return a path count as a solve total.
    */
    const solved =
      solvedAnchor ??
      num(
        pick(html, /(?:Total\s*)?Problems?\s*Solved\s*[:-]?\s*<\/?[^>]*>?\s*([\d,]+)/i) ??
          pick(html, /Problems?\s*Solved[\s\S]{0,80}?([\d,]+)/i),
      );

    /*
      Read the history off the RAW body, not the stripped one.

      `var all_rating = [...]` is script content, so the <script> strip above
      deletes it outright — the parse could never match and every profile
      recorded an empty contest graph. The strip exists to stop CSS and inline JS
      from impersonating rendered numbers; here the inline JS *is* the source, and
      it is anchored to its own variable name rather than to a class, so nothing
      in a stylesheet can imitate it.
    */
    const history = parseRatingHistory(raw);
    /*
      Stars: prefer what the page actually renders, fall back to deriving them.

      VERIFIED markup:
        <div class="rating-star"><span style="background-color:#666666">★</span></div>

      One <span> per star, so counting them is exact. starsFromRating() stays as
      the fallback because it is right for the common case, but CodeChef has
      moved its band cut-points before and the rendered glyphs cannot drift.
    */
    const starBlock = pick(html, /class="rating-star"[^>]*>([\s\S]{0,400}?)<\/div>/i);
    const renderedStars = starBlock ? (starBlock.match(/★/g) ?? []).length : 0;
    const stars = renderedStars > 0 ? renderedStars : starsFromRating(rating);

    /*
      Contest count from the page, not from the history array's length.

      VERIFIED: "No. of Contests Participated: <b>14</b>". The old code used
      history.length, which counts RATED entries only and gave 12 for the same
      user — a quiet undercount rather than a visible failure.
    */
    const contestsShown = num(
      pick(html, /No\.\s*of\s*Contests\s*Participated:\s*<b[^>]*>\s*([\d,]+)/i),
    );

    /*
      A COMPETED account with no readable rating means our parser broke.

      The "Total Problems Solved" anchor above deliberately tolerates a missing
      rating, because a never-competed student genuinely has no rating widget.
      That tolerance is also a blind spot: if a redesign renames .rating-number,
      every rated student silently degrades to rating null, and the next refresh
      overwrites a real 3355 with nothing.

      The contest record is the tie-breaker, and it comes from two independent
      places — the inline all_rating array and the "No. of Contests
      Participated" text. Either one being non-zero proves the account has
      competed, and an account that has competed always renders a rating. So
      "competed but no rating" is a contradiction the page itself cannot produce,
      and it is exactly what a markup change looks like from here.

      Unrated users still pass: empty history, zero contests, no rating, no
      complaint.
    */
    parseAssert(
      rating !== null || (history.length === 0 && !contestsShown),
      ID,
      `rating for a competed account (${history.length} rated contests, ` +
        `${contestsShown ?? 0} shown, but .rating-number is missing)`,
    );

    return {
      displayName: pick(html, /<h1[^>]*class="[^"]*h2-style[^"]*"[^>]*>\s*([^<]+)</i) ?? handle,
      country: pick(html, /user-country-name"?[^>]*>\s*([^<]+)</i),

      // No difficulty split anywhere on CodeChef, so the count is unrated rather
      // than invented into buckets.
      totalSolved: solved ?? undefined,
      unratedSolved: solved ?? undefined,

      rating,
      maxRating: maxRating ?? (history.length ? Math.max(...history.map((h) => h.rating)) : null),
      globalRank,
      countryRank,
      stars,
      contestsAttended: contestsShown ?? history.length ?? undefined,

      data: {
        institution: pick(html, /Institution:?\s*<\/(?:label|span)>\s*<span[^>]*>\s*([^<]+)</i),
        division: pick(html, /\(Div\s*(\d)\)/i),
        rating_history: history,
      },
      // solved is the most fragile of these; flag rather than fail, because
      // rating and rank are still worth recording.
      partial: solved === null,
    };
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const res = await request(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
        platformId: ID,
        timeoutMs: 20_000,
      });
      if (!/user-details|rating-number|userdetails-container/i.test(res.body)) {
        return { ok: false, reason: "No such CodeChef user" };
      }
      return {
        ok: true,
        displayName:
          pick(res.body, /<h1[^>]*class="[^"]*h2-style[^"]*"[^>]*>\s*([^<]+)</i) ?? handle,
      };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such CodeChef user" };
      }
      throw e;
    }
  },
};

export const __test = { starsFromRating, parseRatingHistory, pick };
