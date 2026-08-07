/**
 * Standing, in every sense a user might mean it. These are genuinely different
 * questions and conflating them is how the table ended up labelling a worldwide
 * LeetCode number "Rank" — the one a faculty member is least likely to mean.
 *
 *   Almanac Score  — difficulty-weighted across every platform the student uses.
 *                    Weights live in `platforms`, so this is tunable without a deploy.
 *   Class rank     — position within one cohort, by Almanac Score.
 *   College rank   — position within the student's own institution.
 *   Overall rank   — position across every college on the platform.
 *   Platform ranks — standing on ONE platform, among only the students who
 *                    actually use it, by that platform's own metric (rating for
 *                    Codeforces and CodeChef, solved count for LeetCode).
 *   LeetCode world rank — still scraped from the profile, still not a measure of
 *                    standing here. Rendered separately, never as "Rank".
 */

export type ClassroomRank = {
  classroom_id: string;
  classroom_name: string;
  rank: number;
  total: number;
};

export type PlatformRank = {
  platform_id: string;
  platform_name: string;
  /** Which number this platform is ranked on: 'solved' | 'rating' | 'score'. */
  metric: string;
  value: number | null;
  college_rank: number;
  college_total: number;
  overall_rank: number;
  overall_total: number;
};

export type StudentRanks = {
  almanac_score: number;
  /** Per-platform contribution to the score, for the breakdown chart. */
  score_breakdown: Record<string, number>;
  college_id: string | null;
  college_name: string | null;
  college_rank: number;
  college_total: number;
  overall_rank: number;
  overall_total: number;
  classroom_ranks: ClassroomRank[];
  platform_ranks: PlatformRank[];
};

/** Empty map for empty input — the RPC would otherwise be a wasted round trip. */
export async function fetchStudentRanks(studentIds: string[]): Promise<Map<string, StudentRanks>> {
  const out = new Map<string, StudentRanks>();
  if (studentIds.length === 0) return out;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("student_ranks_v2", {
    p_student_ids: studentIds,
  });
  // Ranks are decoration on top of the real numbers; a failure here must not take
  // down a classroom page. Callers treat a missing entry as "no rank yet".
  if (error || !data) return out;

  for (const row of data) {
    out.set(row.student_id, {
      almanac_score: Number(row.almanac_score ?? 0),
      score_breakdown: (row.score_breakdown as unknown as Record<string, number>) ?? {},
      college_id: row.college_id,
      college_name: row.college_name,
      college_rank: row.college_rank,
      college_total: row.college_total,
      overall_rank: row.overall_rank,
      overall_total: row.overall_total,
      classroom_ranks: (row.classroom_ranks as unknown as ClassroomRank[]) ?? [],
      platform_ranks: (row.platform_ranks as unknown as PlatformRank[]) ?? [],
    });
  }
  return out;
}
