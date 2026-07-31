/**
 * Three different ranks, and they are genuinely three different questions:
 *
 *   LeetCode rank  — `student_stats.ranking`, worldwide, scraped off the profile.
 *                    Millions of users. Not a measure of standing here.
 *   Class rank     — position within one cohort, by problems solved.
 *   College rank   — position across every student on the platform.
 *
 * The table used to show only the first, labelled "Rank", which is the one a
 * faculty member is least likely to mean.
 */
export type StudentRanks = {
  college_rank: number;
  college_total: number;
  classroom_ranks: { classroom_id: string; classroom_name: string; rank: number; total: number }[];
};

/** Empty map for an empty input — the RPC would otherwise be a wasted round trip. */
export async function fetchStudentRanks(
  studentIds: string[],
): Promise<Map<string, StudentRanks>> {
  const out = new Map<string, StudentRanks>();
  if (studentIds.length === 0) return out;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("student_ranks", {
    p_student_ids: studentIds,
  });
  // Ranks are decoration on top of the real numbers; a failure here should not
  // take down a classroom page.
  if (error || !data) return out;

  for (const row of data) {
    out.set(row.student_id, {
      college_rank: row.college_rank,
      college_total: row.college_total,
      classroom_ranks:
        (row.classroom_ranks as unknown as StudentRanks["classroom_ranks"]) ?? [],
    });
  }
  return out;
}
