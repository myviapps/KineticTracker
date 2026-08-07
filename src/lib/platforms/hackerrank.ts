// HackerRank adapter.
//
// Three undocumented JSON endpoints, all verified live:
//
//   /rest/contests/master/hackers/{h}/profile — identity. NOTE the path: the
//     commonly-cited /rest/hackers/{h}/profile returns 404 for every user.
//   /rest/hackers/{h}/badges     — per-track stars AND solved counts.
//   /rest/hackers/{h}/scores_elo — per-track practice/contest score and rank.
//
// The solved count is the subtle part. The profile model has no
// solved_challenges field — a widely-copied scraper reads one and silently gets
// null forever. The real counts live in the badges response as
// `solved`/`total_challenges` per track, so the platform total is their sum.
//
// HackerRank reports no difficulty at all, only tracks and stars, so everything
// lands in unratedSolved and the composite weights it via weight_unrated.

import { getJson } from "./http";
import {
  PlatformError,
  num,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "hackerrank";
const BASE = "https://www.hackerrank.com";
const HEADERS = { Referer: "https://www.hackerrank.com/", Accept: "application/json" };

type HrProfile = {
  model?: {
    id?: number;
    username?: string;
    name?: string;
    country?: string;
    school?: string;
    company?: string;
    job_title?: string;
    level?: number;
    avatar?: string;
    website?: string;
    short_bio?: string;
    title?: string;
    created_at?: string;
    followers_count?: number;
  };
};

type HrBadge = {
  badge_name?: string;
  badge_type?: string;
  stars?: number;
  total_stars?: number;
  solved?: number;
  total_challenges?: number;
  hacker_rank?: number;
  current_points?: number;
  level?: number;
};

type HrTrack = {
  name?: string;
  slug?: string;
  practice?: { score?: number; rank?: number | string };
  contest?: { score?: number; rank?: number | string; medals?: Record<string, number> };
};

export const hackerrankAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    const h = encodeURIComponent(handle);

    const profile = await getJson<HrProfile>(
      `${BASE}/rest/contests/master/hackers/${h}/profile`,
      ctx,
      { headers: HEADERS, platformId: ID },
    );
    const m = profile.model;
    if (!m?.username) {
      throw new PlatformError("not_found", 200, `No HackerRank user "${handle}"`, ID);
    }

    // Badges and scores are enrichment. A student with a valid profile and no
    // badges is a real, complete answer — not a failure — so both are tolerated.
    let badges: HrBadge[] = [];
    let tracks: HrTrack[] = [];
    let badgesOk = false;

    try {
      const b = await getJson<{ models?: HrBadge[] }>(`${BASE}/rest/hackers/${h}/badges`, ctx, {
        headers: HEADERS,
        platformId: ID,
      });
      badges = b.models ?? [];
      badgesOk = true;
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "budget") throw e;
    }

    try {
      tracks = await getJson<HrTrack[]>(`${BASE}/rest/hackers/${h}/scores_elo`, ctx, {
        headers: HEADERS,
        platformId: ID,
      });
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "budget") throw e;
    }

    const totalSolved = badgesOk
      ? badges.reduce((sum, b) => sum + (num(b.solved) ?? 0), 0)
      : undefined;
    const totalStars = badgesOk
      ? badges.reduce((sum, b) => sum + (num(b.stars) ?? 0), 0)
      : undefined;

    // The best rank across tracks. A single "HackerRank rank" does not exist —
    // this is the most flattering true statement available, and the per-track
    // detail is kept in data so the UI can show the honest breakdown.
    /*
      A rank is only meaningful on a track the student has actually scored on.

      MEASURED on 2026-08-04 against procoder052003, an account with nothing
      solved: HackerRank returned 20 tracks, 19 of them with honest last-place
      ranks (35k, 141k, 5.9M …) and one — "General Programming" — reporting
      `score: 0.0, rank: 1`. It is a placeholder for a track never attempted, not
      a standing.

      Filtering on `rank > 0` alone let Math.min seize that 1, so a student with
      zero solved problems was published as RANK #1 IN THE WORLD, which would
      have put them straight to the top of the college leaderboard.

      Requiring a non-zero score is what makes the rank mean what it says.
    */
    const practiceRanks = (Array.isArray(tracks) ? tracks : [])
      .filter((t) => (num(t.practice?.score) ?? 0) > 0)
      .map((t) => num(t.practice?.rank))
      .filter((r): r is number => r !== null && r > 0);
    const bestRank = practiceRanks.length ? Math.min(...practiceRanks) : null;

    const practiceScore = (Array.isArray(tracks) ? tracks : []).reduce(
      (sum, t) => sum + (num(t.practice?.score) ?? 0),
      0,
    );

    return {
      displayName: m.name ?? m.username,
      avatar: m.avatar ?? null,
      country: m.country ?? null,

      // HackerRank publishes no difficulty split, so the whole count is unrated
      // rather than guessed into easy/medium/hard.
      totalSolved,
      unratedSolved: totalSolved,
      stars: totalStars,
      globalRank: bestRank,
      platformScore: Array.isArray(tracks) && tracks.length ? practiceScore : undefined,

      data: {
        level: m.level ?? null,
        school: m.school ?? null,
        company: m.company ?? null,
        job_title: m.job_title ?? null,
        title: m.title ?? null,
        short_bio: m.short_bio ?? null,
        website: m.website ?? null,
        followers_count: m.followers_count ?? null,
        created_at: m.created_at ?? null,
        badges: badges.map((b) => ({
          name: b.badge_name ?? null,
          stars: num(b.stars),
          solved: num(b.solved),
          total: num(b.total_challenges),
          rank: num(b.hacker_rank),
          points: num(b.current_points),
        })),
        tracks: (Array.isArray(tracks) ? tracks : []).map((t) => ({
          name: t.name ?? null,
          slug: t.slug ?? null,
          practice_score: num(t.practice?.score),
          practice_rank: num(t.practice?.rank),
          contest_score: num(t.contest?.score),
          contest_rank: num(t.contest?.rank),
          medals: t.contest?.medals ?? null,
        })),
      },
      partial: !badgesOk,
    };
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const p = await getJson<HrProfile>(
        `${BASE}/rest/contests/master/hackers/${encodeURIComponent(handle)}/profile`,
        ctx,
        { headers: HEADERS, platformId: ID },
      );
      if (!p.model?.username) return { ok: false, reason: "No such HackerRank user" };
      return { ok: true, displayName: p.model.name ?? p.model.username };
    } catch (e) {
      if (e instanceof PlatformError && e.kind === "not_found") {
        return { ok: false, reason: "No such HackerRank user" };
      }
      throw e;
    }
  },
};
