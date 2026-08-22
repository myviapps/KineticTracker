// LeetCode adapter.
//
// Deliberately a THIN MAPPING over the existing fetchLeetCodeProfile rather than
// a rewrite. That function is the one piece of this system with a year of
// production behind it — the 250ms inter-call spacing, the non-fatal
// calendar/recent handling and the retry tuning were all learned the hard way.
// Re-deriving them inside a new adapter would be re-earning the same scars.
//
// So this file only translates LeetCode's shape into the canonical one. Its job
// is to prove the adapter interface can express the richest platform we have; if
// it could not, the interface would be wrong.

import { fetchLeetCodeProfile, LeetCodeError } from "../leetcode.server";
import {
  PlatformError,
  type FetchContext,
  type NormalizedProfile,
  type PlatformAdapter,
  type VerifyResult,
} from "./types";

const ID = "leetcode";

/** LeetCodeError predates the shared taxonomy; map it rather than duplicate it. */
function toPlatformError(e: unknown): PlatformError {
  if (e instanceof PlatformError) return e;

  if (e instanceof LeetCodeError || (e as { name?: string })?.name === "LeetCodeError") {
    const err = e as LeetCodeError;
    return new PlatformError(err.kind, err.status, err.message, ID);
  }

  const msg = e instanceof Error ? e.message : String(e);
  // fetchLeetCodeProfile throws a plain Error for a missing matchedUser.
  if (/not found/i.test(msg)) return new PlatformError("not_found", 404, msg, ID);
  return new PlatformError("fail", 0, msg, ID);
}

export const leetcodeAdapter: PlatformAdapter = {
  id: ID,

  async fetchProfile(handle: string, ctx: FetchContext = {}): Promise<NormalizedProfile> {
    try {
      const p = await fetchLeetCodeProfile(handle, ctx.deadline);

      // The calendar and recent-submission calls are best-effort and get skipped
      // when the chunk runs short. Empty results from a student who genuinely has
      // none are indistinguishable here, so `partial` is advisory only — it
      // never suppresses a write.
      //
      // `undefined` is now the honest signal that no calendar arrived at all; a
      // real 0 means the calendar came back and the student is simply inactive.
      // The old test read both as 0 and could not tell them apart.
      const partial = p.streak === undefined && p.recent.length === 0;

      return {
        displayName: p.realName,
        avatar: p.avatar,
        country: p.country,

        totalSolved: p.totalSolved,
        easySolved: p.easySolved,
        mediumSolved: p.mediumSolved,
        hardSolved: p.hardSolved,

        rating: p.contestRating,
        globalRank: p.ranking,
        streak: p.streak,
        contestsAttended: p.contestsAttended,

        data: {
          reputation: p.reputation,
          total_questions: p.totalQuestions,
          easy_total: p.easyTotal,
          medium_total: p.mediumTotal,
          hard_total: p.hardTotal,
          acceptance_rate: p.acceptanceRate,
          total_active_days: p.totalActiveDays,
          contest_global_ranking: p.contestGlobalRanking,
          contest_top_percentage: p.contestTopPercentage,
          submission_calendar: p.submissionCalendar,
          language_stats: p.languageStats,
          tag_stats: p.tagStats,
          badges: p.badges,
          recent: p.recent,
        },
        partial,
      };
    } catch (e) {
      throw toPlatformError(e);
    }
  },

  async verifyHandle(handle: string, ctx: FetchContext = {}): Promise<VerifyResult> {
    try {
      const p = await fetchLeetCodeProfile(handle, ctx.deadline);
      return { ok: true, displayName: p.realName ?? handle };
    } catch (e) {
      const err = toPlatformError(e);
      if (err.kind === "not_found") return { ok: false, reason: "No such LeetCode user" };
      throw err;
    }
  },
};
