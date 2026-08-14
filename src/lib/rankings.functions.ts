import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";

/**
 * `.in()` with many uuids blows the request URL length limit.
 *
 * 100, not 500: a uuid plus its comma is 37 chars, so 500 of them is an ~18KB
 * query string — past the point where the request fails outright as an opaque
 * `TypeError: fetch failed` rather than a PostgREST error. 100 keeps it near
 * 4KB, comfortably inside every proxy limit in the path.
 */
const CHUNK = 100;

async function chunked<T>(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await run(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    if (data) out.push(...data);
  }
  return out;
}

/** One enabled platform's scoring coefficients, for the on-page explainer. */
export type ScoringPlatform = {
  id: string;
  name: string;
  weight_easy: number;
  weight_medium: number;
  weight_hard: number;
  weight_unrated: number;
  rating_baseline: number | null;
  rating_weight: number;
};

export type RankingRow = {
  id: string;
  name: string;
  roll: string;
  avatar: string | null;
  classroom_ids: string[];
  classroom_names: string[];
  college_id: string | null;
  college_name: string | null;
  almanac_score: number;
  score_breakdown: Record<string, number>;
  /** Solved counts summed across ENABLED platforms only — matches the score. */
  easy: number;
  medium: number;
  hard: number;
  unrated: number;
  college_rank: number | null;
  college_total: number | null;
  overall_rank: number | null;
  overall_total: number | null;
  classroom_ranks: { classroom_id: string; classroom_name: string; rank: number; total: number }[];
};

/**
 * Standing across the caller's scope, one row per student, all three rank
 * levels (classroom / college / overall) at once.
 *
 * `student_ranks_v2` already computes every level in one round trip — see
 * ranks.server.ts — so this fetches once and lets the Rankings page show all
 * of them side by side instead of re-querying per rank type.
 */
export const getRankings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    const classroomIds = await accessibleClassroomIds(userId, role);

    let clsQuery = supabaseAdmin.from("classrooms").select("id, name, college_id");
    if (classroomIds !== null) clsQuery = clsQuery.in("id", classroomIds);
    const { data: classrooms, error: clsErr } = await clsQuery;
    if (clsErr) throw new Error(`Failed to load classrooms: ${clsErr.message}`);

    /*
      The scoring weights are read live rather than hardcoded: they are columns
      on `platforms` precisely so an admin can recalibrate without a deploy, and
      the explainer would start lying the moment someone did. Only ENABLED
      platforms contribute to the Almanac Score (see the student_scores view),
      so this doubles as the honest answer to "which platforms count".
    */
    const { data: scoringRows, error: scoringErr } = await supabaseAdmin
      .from("platforms")
      .select(
        "id, name, weight_easy, weight_medium, weight_hard, weight_unrated, rating_baseline, rating_weight, sort_order",
      )
      .eq("enabled", true)
      .order("sort_order");
    if (scoringErr) throw new Error(`Failed to load scoring weights: ${scoringErr.message}`);

    const scoring: ScoringPlatform[] = (scoringRows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      weight_easy: p.weight_easy,
      weight_medium: p.weight_medium,
      weight_hard: p.weight_hard,
      weight_unrated: p.weight_unrated,
      rating_baseline: p.rating_baseline,
      rating_weight: p.rating_weight,
    }));
    const enabledPlatformIds = scoring.map((p) => p.id);

    if (!classrooms?.length) {
      return {
        scoped: classroomIds !== null,
        classrooms: [],
        colleges: [] as { id: string; name: string }[],
        scoring,
        students: [] as RankingRow[],
      };
    }

    const collegeIds = [
      ...new Set(classrooms.map((c) => c.college_id).filter(Boolean)),
    ] as string[];
    const { data: colleges, error: collegeErr } = collegeIds.length
      ? await supabaseAdmin.from("colleges").select("id, name").in("id", collegeIds)
      : { data: [] as { id: string; name: string }[], error: null };
    if (collegeErr) throw new Error(`Failed to load colleges: ${collegeErr.message}`);
    const collegeName = new Map((colleges ?? []).map((c) => [c.id, c.name]));
    const classroomOf = new Map(classrooms.map((c) => [c.id, c]));
    // Every college the caller can reach, named — not just the ones that turn
    // out to have a ranked student. A freshly assigned classroom with no
    // students yet would otherwise leave its college unnamed in the filter UI.
    const collegesOut = (colleges ?? []).map((c) => ({ id: c.id, name: c.name }));

    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("classroom_students")
      .select("student_id, classroom_id")
      .in(
        "classroom_id",
        classrooms.map((c) => c.id),
      );
    if (memErr) throw new Error(`Failed to load rosters: ${memErr.message}`);

    const classroomIdsByStudent = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const list = classroomIdsByStudent.get(m.student_id);
      if (list) list.push(m.classroom_id);
      else classroomIdsByStudent.set(m.student_id, [m.classroom_id]);
    }
    const studentIds = [...classroomIdsByStudent.keys()];
    if (studentIds.length === 0) {
      return {
        scoped: classroomIds !== null,
        classrooms: classrooms.map((c) => ({ id: c.id, name: c.name, college_id: c.college_id })),
        colleges: collegesOut,
        scoring,
        students: [] as RankingRow[],
      };
    }

    const students = await chunked(studentIds, (batch) =>
      supabaseAdmin.from("students").select("id, name, roll").in("id", batch),
    );

    // Avatar comes from the legacy LeetCode stats row, the same source the
    // header search already renders (search.functions.ts).
    const avatarRows = await chunked(studentIds, (batch) =>
      supabaseAdmin.from("student_stats").select("student_id, avatar").in("student_id", batch),
    );
    const avatarByStudent = new Map(avatarRows.map((s) => [s.student_id, s.avatar]));

    /*
      Difficulty split for the per-row hover, summed over ENABLED platforms only
      so it reconciles with the score itself rather than quietly counting
      platforms that contribute nothing. `platform_stats` carries `student_id`
      directly, so this needs no join through student_platform_accounts.
    */
    const diffRows = enabledPlatformIds.length
      ? await chunked(studentIds, (batch) =>
          supabaseAdmin
            .from("platform_stats")
            .select("student_id, easy_solved, medium_solved, hard_solved, unrated_solved")
            .in("student_id", batch)
            .in("platform_id", enabledPlatformIds),
        )
      : [];

    const diffByStudent = new Map<
      string,
      { easy: number; medium: number; hard: number; unrated: number }
    >();
    for (const d of diffRows) {
      const acc = diffByStudent.get(d.student_id) ?? { easy: 0, medium: 0, hard: 0, unrated: 0 };
      acc.easy += d.easy_solved ?? 0;
      acc.medium += d.medium_solved ?? 0;
      acc.hard += d.hard_solved ?? 0;
      acc.unrated += d.unrated_solved ?? 0;
      diffByStudent.set(d.student_id, acc);
    }

    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const ranks = await fetchStudentRanks(studentIds);

    const rows: RankingRow[] = students
      .map((s) => {
        const r = ranks.get(s.id);
        const cIds = classroomIdsByStudent.get(s.id) ?? [];
        const collegeIdFallback =
          cIds.map((cid) => classroomOf.get(cid)?.college_id).find(Boolean) ?? null;
        const diff = diffByStudent.get(s.id) ?? { easy: 0, medium: 0, hard: 0, unrated: 0 };
        return {
          id: s.id,
          name: s.name,
          roll: s.roll,
          avatar: avatarByStudent.get(s.id) ?? null,
          classroom_ids: cIds,
          classroom_names: cIds
            .map((cid) => classroomOf.get(cid)?.name)
            .filter((n): n is string => !!n)
            .sort(),
          college_id: r?.college_id ?? collegeIdFallback,
          college_name:
            r?.college_name ??
            (collegeIdFallback ? (collegeName.get(collegeIdFallback) ?? null) : null),
          almanac_score: r?.almanac_score ?? 0,
          score_breakdown: r?.score_breakdown ?? {},
          easy: diff.easy,
          medium: diff.medium,
          hard: diff.hard,
          unrated: diff.unrated,
          college_rank: r?.college_rank ?? null,
          college_total: r?.college_total ?? null,
          overall_rank: r?.overall_rank ?? null,
          overall_total: r?.overall_total ?? null,
          classroom_ranks: r?.classroom_ranks ?? [],
        };
      })
      .sort((a, b) => b.almanac_score - a.almanac_score);

    return {
      scoped: classroomIds !== null,
      classrooms: classrooms.map((c) => ({ id: c.id, name: c.name, college_id: c.college_id })),
      colleges: collegesOut,
      scoring,
      students: rows,
    };
  });
