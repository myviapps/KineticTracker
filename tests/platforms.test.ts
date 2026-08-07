// Adapter tests against REAL captured responses (tests/fixtures/**).
//
// Fixtures are recorded from the live platforms rather than hand-written,
// because a hand-written fixture only ever asserts what the author already
// believed. Two of the bugs these lock down were found exactly this way: the
// HackerRank profile model has no solved_challenges field, and the Codeforces
// 400 body is the only thing that identifies a bad handle in a batch.
//
// fetch is stubbed, so a test that reaches the network hangs and fails rather
// than passing silently against live data.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  codeforcesAdapter,
  __resetProblemsetCache,
  __test as cfTest,
} from "@/lib/platforms/codeforces";
import { hackerrankAdapter } from "@/lib/platforms/hackerrank";
import { codechefAdapter, __test as ccTest } from "@/lib/platforms/codechef";
import { geeksforgeeksAdapter, __test as gfgTest } from "@/lib/platforms/geeksforgeeks";
import { PlatformError } from "@/lib/platforms/types";
import { extractEnclosingJson, request } from "@/lib/platforms/http";
import { parseCsvText, templateCsv, PLATFORM_COLUMNS } from "@/lib/file-parser";

/** Adapter pacing is real time; stubbed fetch must not wait on it. */
const FAST = { callGapMs: 0 } as const;

const DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fx = (p: string) => readFileSync(DIR + p, "utf8");

/** Serve fixtures by URL substring; anything unrouted is a test bug, not a 404. */
type Route = { match: string; status?: number; body: string; contentType?: string };

function stubFetch(routes: Route[]) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`unrouted fetch in test: ${url}`);
    return new Response(hit.body, {
      status: hit.status ?? 200,
      headers: { "content-type": hit.contentType ?? "application/json" },
    });
  });
}

beforeEach(() => __resetProblemsetCache());
afterEach(() => vi.unstubAllGlobals());

// ════════════════════════════════════════════════════════════════════════════
describe("codeforces", () => {
  const routes = (): Route[] => [
    { match: "problemset.problems", body: fx("codeforces/problemset-sample.json") },
    { match: "user.rating", body: fx("codeforces/user-rating.json") },
    { match: "user.status", body: fx("codeforces/user-status.json") },
    { match: "user.info", body: fx("codeforces/user-info.json") },
  ];

  it("maps identity and rating from the real payload", async () => {
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("tourist", FAST);
    expect(p.displayName).toBe("Gennady Korotkevich");
    expect(p.rating).toBe(3530);
    expect(p.maxRating).toBe(4009);
    expect(p.country).toBe("Belarus");
  });

  it("keeps rank as a TITLE and never as a sortable position", async () => {
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("tourist", FAST);
    // user.info.rank is "legendary grandmaster". Putting that in global_rank
    // would make every per-platform leaderboard sort on nonsense.
    expect(p.globalRank).toBeNull();
    expect(p.data?.cf_rank_title).toBe("legendary grandmaster");
  });

  it("derives solved count and difficulty buckets that reconcile", async () => {
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("x", FAST);
    const sum =
      (p.easySolved ?? 0) + (p.mediumSolved ?? 0) + (p.hardSolved ?? 0) + (p.unratedSolved ?? 0);
    expect(sum).toBe(p.totalSolved);
    expect(p.totalSolved).toBeGreaterThan(0);
  });

  it("emits a syncCursor so the next refresh is incremental", async () => {
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("x", FAST);
    expect(p.syncCursor?.newestId).toBeGreaterThan(0);
    expect(Array.isArray(p.syncCursor?.solved)).toBe(true);
  });

  it("counts a problem once no matter how often it was solved", async () => {
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("x", FAST);
    const solved = p.syncCursor?.solved as string[];
    expect(new Set(solved).size).toBe(solved.length);
  });

  it("resumes from a stored cursor instead of recounting", async () => {
    stubFetch(routes());
    const first = await codeforcesAdapter.fetchProfile("x", FAST);
    const cursor = first.syncCursor!;

    // Same fixture, but everything is now at or below the cursor, so a second
    // pass must add nothing rather than double-count.
    stubFetch(routes());
    const second = await codeforcesAdapter.fetchProfile("x", { ...FAST, syncCursor: cursor });
    expect(second.totalSolved).toBe(first.totalSolved);
  });

  it("buckets ratings at the documented cut points", () => {
    expect(cfTest.bucketOf(800)).toBe("easy");
    expect(cfTest.bucketOf(1199)).toBe("easy");
    expect(cfTest.bucketOf(1200)).toBe("medium");
    expect(cfTest.bucketOf(1899)).toBe("medium");
    expect(cfTest.bucketOf(1900)).toBe("hard");
    expect(cfTest.bucketOf(null)).toBe("unrated");
  });

  it("extracts the offending handle from the real 400 body", () => {
    const body = JSON.parse(fx("codeforces/user-info-poisoned-batch.json")) as { comment: string };
    expect(cfTest.offendingHandle(body.comment)).toBe("zzz_no_such_user_zzz_9");
  });

  it("reports an unknown handle as not_found, not a generic failure", async () => {
    stubFetch([
      { match: "user.info", status: 400, body: fx("codeforces/user-info-poisoned-batch.json") },
    ]);
    await expect(codeforcesAdapter.fetchProfile("nope", FAST)).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("BATCH: one bad handle must not fail the other ninety-nine", async () => {
    // First user.info call fails with the poisoned-batch 400; after the offender
    // is evicted, the retry succeeds. This is the regression that matters most:
    // a single typo previously failed the entire cohort.
    let infoCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("problemset.problems"))
        return new Response(fx("codeforces/problemset-sample.json"), { status: 200 });
      if (url.includes("user.status"))
        return new Response(fx("codeforces/user-status.json"), { status: 200 });
      if (url.includes("user.info")) {
        infoCalls++;
        if (infoCalls === 1)
          return new Response(fx("codeforces/user-info-poisoned-batch.json"), { status: 400 });
        return new Response(fx("codeforces/user-info.json"), { status: 200 });
      }
      throw new Error(`unrouted: ${url}`);
    });

    const res = await codeforcesAdapter.fetchBatch!(
      [{ handle: "tourist" }, { handle: "zzz_no_such_user_zzz_9" }, { handle: "Petr" }],
      { ...FAST, deadline: Date.now() + 60_000 },
    );

    expect((res.get("zzz_no_such_user_zzz_9") as PlatformError).kind).toBe("not_found");
    expect(res.get("tourist")).not.toBeInstanceOf(PlatformError);
    expect(res.get("Petr")).not.toBeInstanceOf(PlatformError);
  });

  it("BATCH carries each account's cursor, so a walk resumes instead of restarting", async () => {
    // Passing bare handles loses per-account progress: every run re-walks the
    // full history, runs out of budget partway, and the same accounts never
    // finish. Ten of twelve demo accounts sat at null because of exactly this.
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("problemset.problems"))
        return new Response(fx("codeforces/problemset-sample.json"), { status: 200 });
      if (url.includes("user.status")) {
        seen.push(url);
        return new Response(fx("codeforces/user-status.json"), { status: 200 });
      }
      if (url.includes("user.info"))
        return new Response(fx("codeforces/user-info.json"), { status: 200 });
      throw new Error(`unrouted: ${url}`);
    });

    // A cursor whose backfill stopped at offset 1001 must resume there, not at 1.
    await codeforcesAdapter.fetchBatch!(
      [{ handle: "tourist", syncCursor: { backfillFrom: 1001, solved: ["1A"], newestId: 0 } }],
      { ...FAST, deadline: Date.now() + 60_000 },
    );
    expect(seen[0]).toContain("from=1001");
  });

  it("an unfinished walk does NOT advance the high-water mark", async () => {
    // user.status is newest-first, so a truncated walk has seen only the newest
    // pages. Recording that id as done would make the next run stop immediately
    // and never reach the older ones — freezing the backfill permanently.
    stubFetch(routes());
    const p = await codeforcesAdapter.fetchProfile("x", { ...FAST, deadline: Date.now() + 9_000 });
    const cursor = p.syncCursor as { newestId?: number; backfillFrom?: number } | undefined;
    if (p.partial && cursor?.backfillFrom) {
      expect(cursor.newestId ?? 0).toBe(0);
    }
    expect(p.syncCursor).toBeDefined();
  });

  it("a short budget degrades to rating-only rather than reporting zero solved", async () => {
    stubFetch(routes());
    // undefined means "not fetched" and the worker skips the column entirely.
    // Zero would overwrite a real count with a lie.
    const p = await codeforcesAdapter.fetchProfile("x", { ...FAST, deadline: Date.now() + 2_000 });
    expect(p.totalSolved).toBeUndefined();
    expect(p.partial).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("hackerrank", () => {
  const routes = (): Route[] => [
    { match: "/badges", body: fx("hackerrank/badges.json") },
    { match: "/scores_elo", body: fx("hackerrank/scores-elo.json") },
    { match: "/profile", body: fx("hackerrank/profile.json") },
  ];

  it("sums solved from badges, not the non-existent solved_challenges field", async () => {
    stubFetch(routes());
    const p = await hackerrankAdapter.fetchProfile("abhiranjan");

    const badges = JSON.parse(fx("hackerrank/badges.json")).models as { solved?: number }[];
    const expected = badges.reduce((s, b) => s + (b.solved ?? 0), 0);

    expect(p.totalSolved).toBe(expected);
    expect(p.totalSolved).toBeGreaterThan(0);
    // The field the widely-copied scraper reads simply is not in the payload.
    expect(JSON.parse(fx("hackerrank/profile.json")).model).not.toHaveProperty("solved_challenges");
  });

  it("invents no difficulty split, because HackerRank publishes none", async () => {
    stubFetch(routes());
    const p = await hackerrankAdapter.fetchProfile("abhiranjan");
    expect(p.easySolved).toBeUndefined();
    expect(p.mediumSolved).toBeUndefined();
    expect(p.hardSolved).toBeUndefined();
    expect(p.unratedSolved).toBe(p.totalSolved);
  });

  it("keeps per-track detail and the best practice rank", async () => {
    stubFetch(routes());
    const p = await hackerrankAdapter.fetchProfile("abhiranjan");
    expect((p.data?.tracks as unknown[]).length).toBeGreaterThan(5);
    expect(p.globalRank).toBeGreaterThan(0);
    expect(p.stars).toBeGreaterThan(0);
  });

  it("survives badges being unavailable without claiming zero solved", async () => {
    stubFetch([
      { match: "/badges", status: 500, body: "{}" },
      { match: "/scores_elo", body: fx("hackerrank/scores-elo.json") },
      { match: "/profile", body: fx("hackerrank/profile.json") },
    ]);
    const p = await hackerrankAdapter.fetchProfile("abhiranjan");
    expect(p.totalSolved).toBeUndefined();
    expect(p.partial).toBe(true);
    expect(p.displayName).toBeTruthy();
  });

  it("maps 404 to not_found", async () => {
    stubFetch([{ match: "/profile", status: 404, body: fx("hackerrank/profile-notfound.json") }]);
    await expect(hackerrankAdapter.fetchProfile("nope")).rejects.toMatchObject({
      kind: "not_found",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("codechef", () => {
  const html = () => fx("codechef/profile.html");

  it("parses the numbers out of the real profile page", async () => {
    stubFetch([{ match: "codechef.com/users", body: html(), contentType: "text/html" }]);
    const p = await codechefAdapter.fetchProfile("gennady.korotkevich");
    expect(p.rating).toBe(3355);
    expect(p.maxRating).toBe(3445);
    expect(p.country).toBe("Belarus");
    expect(p.totalSolved).toBeGreaterThan(0);
    // The saved page renders "<strong>Inactive</strong> Global Rank" — CodeChef
    // prints that for anyone who has not competed recently, even a #1 account.
    // null is the honest reading; the old fallbacks answered 29176 here by
    // scanning past the label into unrelated markup.
    expect(p.globalRank).toBeNull();
    expect(p.countryRank).toBeNull();
  });

  it("reads the full rating history from the inline all_rating array", async () => {
    stubFetch([{ match: "codechef.com/users", body: html(), contentType: "text/html" }]);
    const p = await codechefAdapter.fetchProfile("x");
    const hist = p.data?.rating_history as { rating: number }[];
    expect(hist.length).toBeGreaterThan(10);
    expect(hist.every((h) => Number.isFinite(h.rating))).toBe(true);
  });

  it("derives stars from rating, since scraping them returned 1 for a 7-star account", () => {
    expect(ccTest.starsFromRating(1399)).toBe(1);
    expect(ccTest.starsFromRating(1400)).toBe(2);
    expect(ccTest.starsFromRating(2000)).toBe(5);
    expect(ccTest.starsFromRating(2500)).toBe(7);
    expect(ccTest.starsFromRating(3355)).toBe(7);
    expect(ccTest.starsFromRating(null)).toBeNull();
  });

  it("FAILS LOUD when the markup changes instead of reporting zeros", async () => {
    // Simulate a redesign that renames the rating element. The adapter must
    // raise parse_error — a broken parser silently writing 0 would wipe every
    // student's rating and history on the next refresh.
    const mangled = html().replace(/rating-number/g, "renamed-by-a-redesign");
    stubFetch([{ match: "codechef.com/users", body: mangled, contentType: "text/html" }]);
    await expect(codechefAdapter.fetchProfile("x")).rejects.toMatchObject({ kind: "parse_error" });
  });

  it("treats a 200 shell with no profile container as not_found", async () => {
    stubFetch([
      {
        match: "codechef.com/users",
        body: "<html><body>nothing</body></html>",
        contentType: "text/html",
      },
    ]);
    await expect(codechefAdapter.fetchProfile("nope")).rejects.toMatchObject({ kind: "not_found" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("geeksforgeeks", () => {
  it("parses the Next.js data route", async () => {
    stubFetch([{ match: "_next/data", body: fx("geeksforgeeks/user-data.json") }]);
    const p = await geeksforgeeksAdapter.fetchProfile("sandeepjain2");
    expect(p.displayName).toBe("Sandeep Jain");
    expect(p.platformScore).not.toBeUndefined();
    expect(p.data).toHaveProperty("heat_map");
  });

  it("returns undefined — never 0 — for a tier the response omits", () => {
    // The single most important property in this file. If a redesign drops the
    // Hard tier, `undefined` leaves the stored value alone; `0` would silently
    // erase every student's hard-problem count.
    expect(gfgTest.tierCount(undefined, "Hard")).toBeUndefined();
    expect(gfgTest.tierCount({}, "Hard")).toBeUndefined();
    expect(gfgTest.tierCount({ Easy: {} }, "Hard")).toBeUndefined();
    // Present-but-empty is a real zero and must read as one.
    expect(gfgTest.tierCount({ Hard: {} }, "Hard")).toBe(0);
    expect(gfgTest.tierCount({ Hard: { a: 1, b: 2 } }, "Hard")).toBe(2);
    expect(gfgTest.tierCount({ hard: 7 }, "Hard")).toBe(7); // case-insensitive
  });

  it("falls back to the auth API when the data route breaks", async () => {
    stubFetch([
      { match: "_next/data", status: 500, body: "{}" },
      { match: "authapi", body: fx("geeksforgeeks/authapi-profile.json") },
    ]);
    const p = await geeksforgeeksAdapter.fetchProfile("sandeepjain2");
    expect(p.displayName).toBe("Sandeep Jain");
    expect(p.partial).toBe(true);
  });

  it("does not spend a second request confirming a known not_found", async () => {
    let authCalls = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("authapi")) authCalls++;
      return new Response(JSON.stringify({ pageProps: {} }), { status: 200 });
    });
    await expect(geeksforgeeksAdapter.fetchProfile("nope")).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(authCalls).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("http error taxonomy", () => {
  it("classifies each status the way the worker depends on", async () => {
    const cases: [number, string][] = [
      [404, "not_found"], // bad handle — never retried
      [403, "throttle"], // bot wall — back off, do not blame the handle
      [503, "throttle"],
      [429, "throttle"],
    ];
    for (const [status, kind] of cases) {
      stubFetch([{ match: "example.com", status, body: "nope" }]);
      await expect(
        request("https://example.com/x", { deadline: Date.now() + 5_000 }),
      ).rejects.toMatchObject({ kind });
    }
  });

  it("attaches the response body so callers can read a platform's reason", async () => {
    stubFetch([{ match: "example.com", status: 400, body: '{"comment":"handle X not found"}' }]);
    const err = await request("https://example.com/x").catch((e) => e as PlatformError);
    expect(err.body).toContain("handle X not found");
  });

  it("refuses to start a request with no budget left, without touching the network", async () => {
    let called = false;
    vi.stubGlobal("fetch", async () => {
      called = true;
      return new Response("{}");
    });
    await expect(
      request("https://example.com/x", { deadline: Date.now() - 1 }),
    ).rejects.toMatchObject({ kind: "budget" });
    expect(called).toBe(false);
  });

  it("lifts a balanced object out of an escaped script payload", () => {
    const payload = 'junk{"a":1,"nested":{"total_problems_solved":42}}trailing';
    const found = extractEnclosingJson(payload, "total_problems_solved");
    expect(JSON.parse(found!)).toEqual({ total_problems_solved: 42 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("bulk import parser", () => {
  it("detects every platform column and its aliases", () => {
    const csv = [
      "Name,Roll No.,Email,Class,LeetCode,CF Handle,Code Chef,GFG,HackerRank",
      "Aarav,24CS001,a@x.edu,CSE-A,aarav_lc,aarav_cf,aarav_cc,aarav_gfg,aarav_hr",
    ].join("\n");
    const r = parseCsvText(csv);
    expect(r.errors).toEqual([]);
    expect(r.detectedPlatforms.sort()).toEqual(
      ["codechef", "codeforces", "geeksforgeeks", "hackerrank", "leetcode"].sort(),
    );
    expect(r.rows[0].handles).toEqual({
      leetcode: "aarav_lc",
      codeforces: "aarav_cf",
      codechef: "aarav_cc",
      geeksforgeeks: "aarav_gfg",
      hackerrank: "aarav_hr",
    });
  });

  it("treats a blank platform cell as absent, not as an error", () => {
    // Most students are not on every platform. Demanding a value would force
    // whoever assembles the sheet to invent one.
    const csv = ["name,roll,classroom,leetcode,codeforces", "Diya,24CS002,CSE-A,diya_lc,"].join(
      "\n",
    );
    const r = parseCsvText(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].handles).toEqual({ leetcode: "diya_lc" });
    expect("codeforces" in r.rows[0].handles).toBe(false);
  });

  it("imports a row that has NO leetcode handle", () => {
    // The old parser hard-required leetcode and dropped the row silently.
    const csv = ["name,roll,classroom,codeforces", "Kabir,24CS003,CSE-A,kabir_cf"].join("\n");
    const r = parseCsvText(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].handles).toEqual({ codeforces: "kabir_cf" });
  });

  it("drops a row with no handles at all — there is nothing to track", () => {
    const csv = ["name,roll,classroom,leetcode", "Ghost,24CS004,CSE-A,"].join("\n");
    expect(parseCsvText(csv).rows).toHaveLength(0);
  });

  it("keeps 'username' and 'handle' mapped to LeetCode", () => {
    // Every existing template uses them for LeetCode; reassigning them would
    // repoint the scraper for a whole cohort.
    const r = parseCsvText(["name,roll,classroom,username", "A,1,X,someone"].join("\n"));
    expect(r.rows[0].handles).toEqual({ leetcode: "someone" });
  });

  it("reports a missing handle column instead of returning zero rows silently", () => {
    const r = parseCsvText(["name,roll,classroom", "A,1,X"].join("\n"));
    expect(r.errors.some((e) => /platform handle column/i.test(e))).toBe(true);
  });

  it("emits a template containing every supported platform", () => {
    const header = templateCsv().split("\n")[0].split(",");
    for (const p of PLATFORM_COLUMNS) expect(header).toContain(p.id);
  });
});

describe("bulk import parser — header folding", () => {
  it("matches headers that end in a separator", () => {
    // "Roll No." folded to "roll no " (trailing space) and matched nothing, so
    // the column was silently dropped and every row failed the roll check.
    for (const header of ["Roll No.", "roll_no", "ROLL NUMBER", "Roll-No", "roll no:"]) {
      const r = parseCsvText([`name,${header},classroom,leetcode`, "A,24CS001,X,a_lc"].join("\n"));
      expect(r.errors, `header "${header}"`).toEqual([]);
      expect(r.rows[0]?.roll, `header "${header}"`).toBe("24CS001");
    }
  });
});
