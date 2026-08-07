// GeeksforGeeks adapter.
//
// GFG has no public API and its profile page is a Next.js App-Router stream —
// there is no __NEXT_DATA__ blob to read, which is what most published scrapers
// still reach for. Two better seams exist, both verified live:
//
//   1. /gfg-assets/_next/data/latest/user/{h}.json — the Next.js data route.
//      Structured JSON carrying userInfo, userSubmissionsInfo, heatMapData,
//      lineChartData, contestData and badgesInfo. This is the primary.
//   2. authapi.geeksforgeeks.org/api-get/user-profile-info/?handle= — a small,
//      clean JSON profile. No difficulty split or heatmap, so it is the fallback.
//
// Both are far sturdier than regexing numbers out of rendered text, which is
// what the difficulty split otherwise requires.

import { getJson } from "./http";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "geeksforgeeks";
const DATA_URL = "https://www.geeksforgeeks.org/gfg-assets/_next/data/latest/user/{h}.json";
const AUTH_URL = "https://authapi.geeksforgeeks.org/api-get/user-profile-info/?handle={h}";
const REFERER = { Referer: "https://www.geeksforgeeks.org/" };

type GfgUserInfo = {
  name?: string;
  profile_image_url?: string;
  institute_name?: string | null;
  institute_rank?: string | number | null;
  score?: number;
  monthly_score?: number;
  total_problems_solved?: number | string;
  pod_solved_current_streak?: number;
  pod_solved_longest_streak?: number;
  created_date?: string;
};

type GfgPageProps = {
  userHandle?: string;
  userInfo?: GfgUserInfo;
  userSubmissionsInfo?: Record<string, unknown>;
  heatMapData?: unknown;
  lineChartData?: unknown;
  badgesInfo?: unknown;
  contestData?: unknown;
  languages?: unknown;
};

/**
 * userSubmissionsInfo is keyed by GFG's own tier names, and each tier is a map
 * of problem-slug → detail rather than a count. Tolerates a plain count too, in
 * case the shape changes.
 *
 * Returns undefined — never 0 — when a tier is absent. A student with no Hard
 * solves and a response that stopped reporting Hard must not look identical.
 */
function tierCount(subs: Record<string, unknown> | undefined, tier: string): number | undefined {
  if (!subs) return undefined;
  const key = Object.keys(subs).find((k) => k.toLowerCase() === tier.toLowerCase());
  if (key === undefined) return undefined;

  const v = subs[key];
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v.length;
  if (typeof v === "object") return Object.keys(v as object).length;
  const n = num(v);
  return n ?? undefined;
}

function fromPageProps(pp: GfgPageProps): NormalizedProfile {
  const info = pp.userInfo ?? {};
  const subs = pp.userSubmissionsInfo;

  // GFG's own tiers collapse onto the canonical buckets. School and Basic are
  // deliberately folded into `unrated` rather than `easy`: they are markedly
  // easier than a LeetCode easy, and the platform's weight_easy of 0.5 plus a
  // low weight_unrated is what stops volume-grinding from dominating the
  // composite score.
  const school = tierCount(subs, "School");
  const basic = tierCount(subs, "Basic");
  const easy = tierCount(subs, "Easy");
  const medium = tierCount(subs, "Medium");
  const hard = tierCount(subs, "Hard");

  const lowTier =
    school === undefined && basic === undefined ? undefined : (school ?? 0) + (basic ?? 0);

  const declaredTotal = num(info.total_problems_solved);
  const summed = [school, basic, easy, medium, hard].some((x) => x !== undefined)
    ? (school ?? 0) + (basic ?? 0) + (easy ?? 0) + (medium ?? 0) + (hard ?? 0)
    : undefined;

  return {
    displayName: info.name ?? null,
    avatar: info.profile_image_url ?? null,

    // Prefer the platform's own figure; fall back to the tier sum.
    totalSolved: declaredTotal ?? summed ?? undefined,
    easySolved: easy,
    mediumSolved: medium,
    hardSolved: hard,
    unratedSolved: lowTier,

    instituteRank: num(info.institute_rank),
    platformScore: num(info.score),
    streak: num(info.pod_solved_current_streak) ?? undefined,

    data: {
      institute_name: info.institute_name ?? null,
      monthly_score: num(info.monthly_score),
      longest_streak: num(info.pod_solved_longest_streak),
      school_solved: school ?? null,
      basic_solved: basic ?? null,
      heat_map: pp.heatMapData ?? null,
      line_chart: pp.lineChartData ?? null,
      badges: pp.badgesInfo ?? null,
      contests: pp.contestData ?? null,
      languages: pp.languages ?? null,
      created_date: info.created_date ?? null,
    },
    // The tier breakdown is the one field most likely to disappear in a
    // redesign; flag its absence instead of silently reporting no difficulty.
    partial: subs === undefined || summed === undefined,
  };
}

async function fetchViaDataRoute(handle: string, ctx: FetchContext): Promise<NormalizedProfile> {
  const json = await getJson<{ pageProps?: GfgPageProps }>(
    DATA_URL.replace("{h}", encodeURIComponent(handle)),
    ctx,
    { headers: REFERER, platformId: ID },
  );
  const pp = json.pageProps;
  // The route answers 200 with an empty payload for an unknown handle rather
  // than 404, so absence of userInfo is the real not-found signal.
  if (!pp?.userInfo) {
    throw new PlatformError("not_found", 200, `No GeeksforGeeks user "${handle}"`, ID);
  }
  return fromPageProps(pp);
}

async function fetchViaAuthApi(handle: string, ctx: FetchContext): Promise<NormalizedProfile> {
  const json = await getJson<{ message?: string; data?: GfgUserInfo }>(
    AUTH_URL.replace("{h}", encodeURIComponent(handle)),
    ctx,
    { headers: REFERER, platformId: ID },
  );
  if (!json.data) {
    throw new PlatformError("not_found", 200, `No GeeksforGeeks user "${handle}"`, ID);
  }
  // No tier breakdown here, so every difficulty field stays undefined and the
  // worker leaves whatever the data route last wrote in place.
  const p = fromPageProps({ userInfo: json.data });
  p.partial = true;
  return p;
}

export const geeksforgeeksAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    try {
      return await fetchViaDataRoute(handle, ctx);
    } catch (e) {
      // A genuine "no such user" is the same answer from both endpoints, so
      // don't spend a second request confirming it. Anything else — the data
      // route moving, a parse failure — is worth the fallback.
      if (e instanceof PlatformError && (e.kind === "not_found" || e.kind === "budget")) throw e;
      return await fetchViaAuthApi(handle, ctx);
    }
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      // The auth API is ~700 bytes against the data route's ~31KB.
      const json = await getJson<{ data?: GfgUserInfo }>(
        AUTH_URL.replace("{h}", encodeURIComponent(handle)),
        ctx,
        { headers: REFERER, platformId: ID },
      );
      if (!json.data) return { ok: false, reason: "No such GeeksforGeeks user" };
      return { ok: true, displayName: json.data.name ?? handle };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such GeeksforGeeks user" };
      }
      throw e;
    }
  },
};

export const __test = { tierCount, fromPageProps };
