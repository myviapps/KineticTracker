// Code360 (Coding Ninjas) adapter.
//
// ── What this file used to be, and why it never worked ──────────────────────
// The original version was built on a three-step theory: the profile page is a
// JS shell, the real numbers come from a public JSON API keyed on an opaque
// per-user UUID, so every student needs a discovery render to dig that UUID out
// of a bootstrap payload, after which the UUID is cached forever in syncCursor.
// Every selector, path and endpoint in it was explicitly marked UNVERIFIED.
//
// MEASURED on 2026-08-05 against the real account /code360/profile/vijaydmb,
// and the theory was wrong in both halves:
//
//   · There is NO uuid. Not in a bootstrap blob, not in a data- attribute, not
//     in an inlined API url — a regex for the canonical UUID shape finds zero
//     matches in the whole 284KB document. The discovery step could never have
//     succeeded for anybody, which is why every fetch ended as parse_error
//     ("the bootstrap payload has probably changed shape") for a payload that
//     had never been seen in the first place.
//   · The page is not a shell. It is Angular SSR, and once rendered it carries
//     every number we want as plain text in semantic markup.
//
// So the API, the UUID discovery, the two-request flow and the syncCursor cache
// are all gone. One render, parsed directly. That is also strictly cheaper than
// the design it replaces, which needed the same render PLUS an API call.
//
// ── Cost ────────────────────────────────────────────────────────────────────
// This page takes ~30s to render, far above every other platform, so it asks
// render.ts for a raised ceiling. That is the real constraint on Code360: at
// batch_size 1 it is the slowest platform in the set, not the most fragile.
//
// ── Anchoring ───────────────────────────────────────────────────────────────
// Angular stamps build-specific `_ngcontent-serverapp-cNNN` attributes on every
// element. NOTHING here anchors on them — they change on each of Naukri's
// deploys and would break the adapter roughly weekly. The class names they sit
// beside (`total`, `difficulty`, `value`, `title`, `day-count-text`) are
// component-level names and are what we key on instead.

import { parseAssert } from "./http";
import { hasRenderer, renderedRequest } from "./render";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "code360";
const PROFILE = "https://www.naukri.com/code360/profile/{h}";

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? (m[1] ?? "").trim() : null;
}

/** Drop <script>/<style> before matching, for the usual reason: state blobs. */
function stripNoise(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/**
 * The four difficulty tiers, VERIFIED shape:
 *
 *   <div class="difficulty ng-star-inserted">
 *     <div class="value">1</div>
 *     <div class="title">Easy</div>
 *   </div>
 *
 * Note "Ninja" — Code360 has FOUR tiers, not three, and Ninja sits above Hard.
 */
function difficultyMap(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re =
    /class="value"[^>]*>\s*([\d,]+)\s*<\/div>\s*<div[^>]*class="title"[^>]*>\s*([^<]+?)\s*<\/div>/gi;
  for (const m of html.matchAll(re)) {
    const n = num(m[1]);
    if (n !== null) out[m[2].toLowerCase()] = n;
  }
  return out;
}

/**
 * Streaks, keyed on their LABEL rather than on document order.
 *
 * VERIFIED shape — note both labels live in a `current-streak-text` div, so the
 * class alone cannot tell them apart and the visible text has to:
 *
 *   <div class="current-streak-text"><p>Current streak:</p></div>
 *   <div class="day-count-text"><p>1 day</p></div>
 *
 * Taking the 1st and 2nd `day-count-text` positionally would work today and
 * break silently the moment Naukri reorders the two, reporting a longest streak
 * as a current one — a wrong number that looks entirely plausible.
 */
function streakAfter(html: string, label: RegExp): number | null {
  const re = new RegExp(
    label.source +
      String.raw`[\s\S]{0,400}?class="day-count-text"[^>]*>\s*<p[^>]*>\s*([\d,]+)\s*day`,
    "i",
  );
  return num(pick(html, re));
}

/** The "about" rail: college + year, default language, and anything else added later. */
function aboutItems(html: string): string[] {
  return [
    ...html.matchAll(/profile-user-about-section-item-text"[^>]*>\s*([^<]+?)\s*<\/div>/gi),
  ].map((m) => m[1].replace(/\s+/g, " ").trim());
}

async function renderProfilePage(handle: string, ctx: FetchContext): Promise<string> {
  /*
    MEASURED on 2026-08-05: this page takes ~29.5s to render on the plain
    browser. The previous settle of 1.5s was not a tuning choice so much as a
    guess, and against the sidecar's 26s default ceiling the fetch could not have
    succeeded at any settle value — every Code360 request was a guaranteed 504
    reported as a dead renderer.

    ceilingMs buys the sidecar (and, in render.ts, our own socket) enough room to
    finish. It is deliberately the only platform that asks for it.

    No `waitFor`: the content is server-rendered by Angular, so it is present in
    the first paint. A selector would only add a way to fail.
  */
  return renderedRequest(PROFILE.replace("{h}", encodeURIComponent(handle)), ctx, {
    settleMs: 6_000,
    ceilingMs: 38_000,
    platformId: ID,
  });
}

export const code360Adapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    // Without the sidecar renderedRequest falls back to a plain GET, which
    // returns a 21KB shell with none of this in it. Say so as `throttle`, so the
    // breaker parks the platform instead of blaming every student's handle.
    if (!hasRenderer()) {
      throw new PlatformError(
        "throttle",
        0,
        "Code360 needs browser rendering — set SCRAPLING_URL to enable it",
        ID,
      );
    }

    const html = stripNoise(await renderProfilePage(handle, ctx));

    /*
      VERIFIED on 2026-08-05 against /code360/profile/Rahul, which does not
      exist: the server answers HTTP 200 and the SPA renders

        "404 - That's an error. But we're not ones to leave you hanging.
         Head to our homepage for a full catalog of awesome stuff."

      None of the phrasings the old code guessed at ("user not found", "no such
      user", "profile does not exist") appear anywhere on it, so an unknown
      handle fell through to be reported as a parse_error. That sends someone
      hunting a redesign that never happened, and because parse_error is not
      terminal the handle is retried at ~30s a go, forever.

      The apostrophe is matched loosely: the page serves a typographic ' and a
      plain ' is the obvious future edit.
    */
    if (
      /404\s*-\s*That'?['‘’]?s\s+an\s+error/i.test(html) ||
      /user\s+not\s+found|no\s+such\s+user|profile\s+(?:does\s+not|doesn'?t)\s+exist/i.test(html)
    ) {
      /*
        CONFIRMED TWICE on 2026-08-05, once by accident:

          · /code360/profile/Rahul — a handle that never existed
          · /code360/profile/vijaydmb — a real account, parsed correctly at
            277KB, then DELETED by its owner mid-session. Every fetch after the
            deletion returned this same page at 61-68KB.

        The size gap is the useful part: a live profile is ~280KB and the 404
        shell is ~65KB, so the two are not subtly different renders of the same
        page — deletion is unambiguous, and the text below identifies it.

        (Worth recording what this ISN'T: the deletion happened while unrelated
        render-timing experiments were running, and the sudden run of 404s looked
        exactly like rate limiting. It was not. Nothing observed here suggests
        Naukri answers throttling with its 404 page — if that is ever seen, this
        must become a `throttle`, because not_found is terminal and would retire
        a real student for good.)
      */
      throw new PlatformError("not_found", 200, `No Code360 user "${handle}"`, ID);
    }

    /*
      The anchor, same role as CodeChef's "Total Problems Solved":

        <div class="total zen-typo-subtitle-large"> 1 Problems solved </div>

      If this is readable the page was understood, so anything else coming back
      empty is a fact about the student rather than about the parser. If it is
      NOT readable we raise parse_error rather than writing a zero, because a
      zeroed Code360 row would wipe a real solve count on the next snapshot.
    */
    const total = num(pick(html, /class="total[^"]*"[^>]*>\s*([\d,]+)\s*Problems?\s*solved/i));
    parseAssert(total !== null, ID, 'the "N Problems solved" total on the profile page');

    const diff = difficultyMap(html);
    const easy = diff.easy ?? null;
    const moderate = diff.moderate ?? null;
    const hard = diff.hard ?? null;
    /*
      "Ninja" is Code360's fourth tier, above Hard, and NormalizedProfile has no
      column for it. It goes to unratedSolved rather than being folded into
      hardSolved, following the same choice geeksforgeeks.ts makes for its
      school/basic tiers: the three named buckets keep meaning exactly what they
      say, and easy + moderate + hard + unrated still reconciles to the total.
      Folding it into hard would inflate the hardest bucket on every leaderboard
      that reads it.
    */
    const ninja = diff.ninja ?? null;

    const about = aboutItems(html);
    // VERIFIED: "GIET Engineering college 2018" and "Java - Default language".
    // The language row is self-labelling; the institution row is whatever is
    // left, so it is identified by exclusion rather than by position.
    const language = about.find((s) => /-\s*Default language$/i.test(s));
    const institution = about.find((s) => s !== language && !/Default language/i.test(s));

    return {
      // The h1 carries the username, not a display name — Code360 shows no real
      // name on a public profile. Echoing the handle back is honest here because
      // it IS what the page renders as the account's identity.
      displayName: pick(html, /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i) ?? handle,

      totalSolved: total,
      easySolved: easy ?? undefined,
      mediumSolved: moderate ?? undefined,
      hardSolved: hard ?? undefined,
      unratedSolved: ninja ?? undefined,

      streak: streakAfter(html, /Current\s+streak:/) ?? undefined,

      data: {
        ninja_solved: ninja,
        longest_streak: streakAfter(html, /Longest\s+streak:/),
        /*
          The row reads "GIET Engineering college 2018" — institution and
          graduation year concatenated into one text node. Split so the name is
          usable on its own; the year is only taken when it is plausibly one
          (19xx/20xx), so a college with a number in its actual name keeps it.
        */
        institution: institution ? institution.replace(/\s*\b(?:19|20)\d{2}\b\s*$/, "") : null,
        graduation_year: institution ? num(pick(institution, /\b((?:19|20)\d{2})\b\s*$/)) : null,
        default_language: language ? language.replace(/\s*-\s*Default language$/i, "") : null,
        profile_views: num(
          pick(html, /profile views\s*<div[^>]*class="count[^"]*"[^>]*>\s*([\d,]+)/i),
        ),
        // The activity heatmap's two tabs. Counts only — the per-day grid is
        // drawn client-side from data we would need a further call to get.
        coding_submissions: num(pick(html, /Coding\s*\(\s*([\d,]+)\s*\)/i)),
        mcq_submissions: num(pick(html, /MCQ\s*\(\s*([\d,]+)\s*\)/i)),
      },

      // The difficulty split is the only optional half. Without it the row is
      // still a correct solve count, which is what Code360 is ranked on.
      partial: easy === null && moderate === null && hard === null,
    };
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const html = stripNoise(await renderProfilePage(handle, ctx));
      if (/404\s*-\s*That'?['‘’]?s\s+an\s+error/i.test(html)) {
        return { ok: false, reason: "No such Code360 user" };
      }
      // Same anchor as the fetch: present means this is a real profile page.
      if (!/class="total[^"]*"[^>]*>\s*[\d,]+\s*Problems?\s*solved/i.test(html)) {
        return { ok: false, reason: "No such Code360 user" };
      }
      return { ok: true, displayName: pick(html, /<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i) ?? handle };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such Code360 user" };
      }
      throw e;
    }
  },
};

export const __test = { difficultyMap, streakAfter, aboutItems, pick, stripNoise };
