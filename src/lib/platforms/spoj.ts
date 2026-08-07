// SPOJ adapter.
//
// SPOJ is the one platform here that is BLOCKED outright: /users/{handle}/
// returns 403 behind a Cloudflare challenge even from a residential IP, so
// there is no version of `request()` that gets a profile back. Every fetch
// therefore goes through renderedRequest with solveCloudflare, and until
// SCRAPLING_URL is set that call throws a `throttle` naming the missing
// renderer. That is the CORRECT outcome, not a gap to route around: throttle is
// the one kind that parks the platform and feeds the circuit breaker without
// blaming a single student's handle or incrementing anyone's failure count.
// Anything cleverer here would convert "we cannot reach SPOJ" into "these 340
// handles are bad".
//
// The parsing below is written against SPOJ's long-stable server-rendered
// layout, but NOTHING in it has been checked against a live page — we have never
// seen one. Every regex is marked UNVERIFIED and each has a fallback, and the
// solved count is asserted rather than defaulted so a wrong guess surfaces as
// parse_error instead of a cohort of zeroes.

import { parseAssert } from "./http";
import { renderedRequest } from "./render";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "spoj";
const PROFILE = "https://www.spoj.com/users/{h}/";

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

async function fetchPage(handle: string, ctx: FetchContext): Promise<string> {
  // solveCloudflare is not optional here — a plain render lands on the
  // interstitial. It also raises the renderer's budget floor to ~25s, which is
  // why SPOJ is worth far fewer accounts per chunk than the other platforms.
  //
  // No `waitFor`: the page is server-rendered once the challenge clears, so
  // there is nothing to wait for, and naming a selector that has moved would
  // turn a working fetch into a renderer timeout.
  return renderedRequest(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
    solveCloudflare: true,
    platformId: ID,
  });
}

/**
 * SPOJ serves a 200 for an unknown user, so not-found is decided on content.
 *
 * UNVERIFIED on both sides: the empty-state wording, and the profile markers.
 * The markers are the important half — requiring one of them is what stops an
 * unrecognised page from being parsed into a plausible-looking empty profile.
 */
function assertProfilePage(html: string, handle: string): void {
  if (/user\s+not\s+found|no\s+such\s+user|couldn'?t\s+find\s+(?:the\s+)?user/i.test(html)) {
    throw new PlatformError("not_found", 200, `No SPOJ user "${handle}"`, ID);
  }
  // UNVERIFIED: `profile-info-data` is the definition list holding rank/points,
  // `user-profile-tables` the solved/todo tables. If SPOJ renames both, this
  // reads as not_found when it should read as parse_error — accepted on purpose,
  // because the alternative is trusting a page we cannot identify.
  if (!/profile-info-data|user-profile-tables|profile-info|Points:/i.test(html)) {
    throw new PlatformError("not_found", 200, `No SPOJ profile page for "${handle}"`, ID);
  }
}

/**
 * The solved count, and the one number this platform is ranked on.
 *
 * Two routes, and the order matters. SPOJ prints the count in the section
 * heading ("Solved problems (137)"), which is authoritative and — critically —
 * still correct at zero. Only when that heading is missing do we fall back to
 * counting problem links inside the solved table, which is fragile because the
 * same markup renders the "to do" list a few hundred bytes further down.
 *
 * Returns null for "could not tell", never 0. A genuine zero comes back as 0
 * from either route; null means we never found the section at all, and the
 * caller turns that into parse_error. Conflating the two is the failure mode
 * that would wipe a real solved history on the next redesign.
 */
function extractSolved(html: string): number | null {
  // UNVERIFIED heading wording. Both orderings seen in the wild historically.
  const heading =
    num(pick(html, /Solved\s*problems?\s*\(\s*([\d,]+)\s*\)/i)) ??
    num(pick(html, /Problems?\s*solved\s*[:\s]*\(?\s*([\d,]+)/i));
  if (heading !== null) return heading;

  // UNVERIFIED container id. Slice from the solved table to whatever comes
  // next so the "to do" table below cannot be counted in — an unbounded count
  // of /problems/ links would roughly double every student's total.
  const start = html.search(/id="user-profile-tables"|class="[^"]*table[^"]*problems[^"]*"/i);
  if (start === -1) return null;
  const section = html.slice(start, start + 200_000).split(/<\/table>/i)[0] ?? "";
  const links = section.match(/href="\/problems\/[A-Za-z0-9_]+\/?"/g);
  return links ? new Set(links).size : null;
}

export const spojAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    const html = await fetchPage(handle, ctx);
    assertProfilePage(html, handle);

    const solved = extractSolved(html);
    parseAssert(solved !== null, ID, "solved problem count (profile tables)");

    // UNVERIFIED. SPOJ labels this "World rank" in the profile definition list;
    // the second pattern catches the older "Rank:" label. Left null when absent
    // rather than guessed — an unranked account is a real state on SPOJ.
    const globalRank = num(
      pick(html, /World\s*rank:?\s*<\/dt>\s*<dd[^>]*>\s*#?\s*([\d,]+)/i) ??
        pick(html, /World\s*rank:?[\s\S]{0,160}?#?\s*([\d,]+)/i) ??
        pick(html, /\bRank:?[\s\S]{0,80}?#?\s*([\d,]+)/i),
    );

    // UNVERIFIED. SPOJ's points are fractional (partial-scoring problems give
    // decimals), so this is deliberately not parsed as an integer.
    const points = num(pick(html, /Points:?[\s\S]{0,160}?([\d]+(?:\.[\d]+)?)/i));

    return {
      // UNVERIFIED: the real name sits next to the avatar. Falls back to the
      // handle, which is always right enough to identify the row.
      displayName:
        pick(html, /class="[^"]*profile-name[^"]*"[^>]*>\s*([^<]+)</i) ??
        pick(html, /<h3[^>]*>\s*([^<]{2,60}?)\s*<\/h3>/i) ??
        handle,
      // UNVERIFIED: SPOJ serves user pictures from /pictures/users/.
      avatar: pick(html, /src="((?:https?:)?\/\/[^"]*pictures\/users\/[^"]+)"/i),
      // UNVERIFIED: the country shows as a flag image whose title/alt is the name.
      country: pick(html, /flags\/[a-z]{2}\.[a-z]{3}"[^>]*(?:title|alt)="([^"]+)"/i),

      totalSolved: solved,
      // SPOJ has no difficulty metadata of any kind — no tags, no rating on a
      // problem — so the entire count is unrated rather than invented into
      // buckets. Same treatment codechef.ts gives its total.
      unratedSolved: solved,

      globalRank,
      platformScore: points,

      data: {
        // UNVERIFIED: the classical/challenge/partial split shown on the profile.
        // Kept raw in `data` rather than mapped onto difficulty columns, because
        // those categories are problem TYPES, not difficulties.
        motto: pick(html, /Motto:?\s*<\/dt>\s*<dd[^>]*>\s*([^<]+)</i),
        institution: pick(html, /Institution:?\s*<\/dt>\s*<dd[^>]*>\s*([^<]+)</i),
      },
      // Rank is the field most likely to have moved, and a solved count on its
      // own is still a rankable row — flag it instead of failing the student.
      partial: globalRank === null,
    };
  },

  /**
   * No cheaper existence check exists: every SPOJ request pays the same
   * Cloudflare solve, so this costs exactly what fetchProfile costs. It is still
   * worth having, because it answers "is this handle real" without the parse
   * assertions — a valid account whose markup we can no longer read verifies
   * fine and fails only at refresh time, which is the honest split.
   */
  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const html = await fetchPage(handle, ctx);
      assertProfilePage(html, handle);
      return {
        ok: true,
        displayName: pick(html, /class="[^"]*profile-name[^"]*"[^>]*>\s*([^<]+)</i) ?? handle,
      };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such SPOJ user" };
      }
      throw e;
    }
  },
};

export const __test = { extractSolved, assertProfilePage, pick };
