// Server-only: per-platform numbers for a roster.
//
// ── Why this is its own .server.ts module ──────────────────────────────────
// This used to be a module-private function inside classrooms.functions.ts,
// which was safe: TanStack strips `createServerFn().handler()` bodies from the
// client bundle, and nothing else could reach it. Exporting it so overview and
// the classrooms grid could reuse it broke that — an exported plain function is
// NOT stripped, so `/dashboard` -> classrooms.functions -> client.server pulled
// the service-role admin client into the browser bundle and Vite's
// import-protection plugin (correctly) complained.
//
// client.server.ts states the rule verbatim: "Top-level import is safe only in
// other .server.ts modules — route files and *.functions.ts ship to the client
// bundle." So it lives here, and every caller imports it dynamically from
// inside a server handler.

import type { CohortPlatform, CohortPlatformStat } from "./classrooms.functions";

/**
 * Per-platform numbers for a whole roster, in two queries.
 *
 * Given an explicit return type for the same reason loadStudentPlatforms is: a
 * nested PostgREST select is deep enough that TypeScript abandons inference and
 * the calling server function's whole return type degrades to `unknown`.
 */
export async function loadCohortPlatformStats(studentIds: string[]): Promise<{
  cohortPlatforms: CohortPlatform[];
  platformStatsById: Map<string, Record<string, CohortPlatformStat>>;
}> {
  const empty = { cohortPlatforms: [], platformStatsById: new Map() };
  if (studentIds.length === 0) return empty;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  /*
    Chunked and paged, with errors thrown.

    Both reads fan out across the whole roster times every platform, so on an
    institution-wide call they are among the largest queries in the app — and
    they are exactly the ones the two silent ceilings bite. `.in()` over ~489
    uuids builds an ~18KB URL and the request FAILS rather than truncating;
    dropping that error returned `empty`, which is indistinguishable from "no
    student is on any platform" — and that is precisely how the overview came to
    report 0% coverage and 0 solved all-time against a full database.
    `.range()` does not help either: PostgREST caps responses at db-max-rows
    whatever Range asks for. See supabase-batch.server.ts.
  */
  const { fetchAllIn } = await import("./supabase-batch.server");

  const accounts = await fetchAllIn(
    studentIds,
    (batch, from, to) =>
      supabaseAdmin
        .from("student_platform_accounts")
        .select("id, student_id, platform_id, handle")
        .in("student_id", batch)
        .range(from, to),
    "cohort platforms: accounts",
  );
  if (!accounts.length) return empty;

  const [stats, { data: platforms, error: platErr }] = await Promise.all([
    fetchAllIn(
      accounts.map((a) => a.id),
      (batch, from, to) =>
        supabaseAdmin
          .from("platform_stats")
          .select(
            "account_id, platform_id, total_solved, rating, max_rating, platform_score, global_rank, fetch_status",
          )
          .in("account_id", batch)
          .range(from, to),
      "cohort platforms: stats",
    ),
    supabaseAdmin
      .from("platforms")
      .select("id, name, rank_metric, sort_order")
      .in("id", [...new Set(accounts.map((a) => a.platform_id))]),
  ]);
  if (platErr) throw new Error(`cohort platforms: platforms: ${platErr.message}`);

  const statByAccount = new Map(stats.map((s) => [s.account_id, s]));
  const byStudent = new Map<string, Record<string, CohortPlatformStat>>();

  for (const a of accounts) {
    const st = statByAccount.get(a.id);
    const bucket = byStudent.get(a.student_id) ?? {};
    bucket[a.platform_id] = {
      total_solved: st?.total_solved ?? null,
      rating: st?.rating ?? null,
      max_rating: st?.max_rating ?? null,
      platform_score: st?.platform_score ?? null,
      global_rank: st?.global_rank ?? null,
      handle: a.handle,
      fetch_status: st?.fetch_status ?? null,
    };
    byStudent.set(a.student_id, bucket);
  }

  const cohortPlatforms = (platforms ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      rank_metric: p.rank_metric ?? "solved",
      sort_order: p.sort_order ?? 100,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  return { cohortPlatforms, platformStatsById: byStudent };
}
