import { createServerFn } from "@tanstack/react-start";

export type LandingStats = {
  students: number | null;
  classrooms: number | null;
  colleges: number | null;
  problemsSolved: number | null;
  platforms: number | null;
  generatedAt: string;
};

/** PostgREST's default db-max-rows silently truncates; ask for more explicitly. */
const MAX_ROWS = 50_000;

/** Module-level cache, 5-minute TTL. Only a result that actually has data is
    cached, so a total outage isn't pinned stale for 5 minutes. */
const cache: Record<string, { at: number; value: LandingStats }> = {};

/**
 * Public aggregate stats for the marketing page — counts only, never identities.
 * This is the deliberate exception to "everything reads through RLS": anon is
 * revoked from `students`, `classrooms` and `student_stats`, so these numbers
 * can only come from the service-role client, and they are the only data it
 * ever exposes without a signed-in viewer.
 *
 * Each query fails in isolation — `allSettled`, never `all` — so a dead table
 * degrades one tile to "—" instead of taking the whole strip down. The handler
 * never throws; every field degrades to null independently.
 */
export const getLandingStats = createServerFn({ method: "GET" }).handler(async () => {
  // Lazy import inside the handler — a top-level import would ship the
  // service-role key to the browser, because this file is imported by a route
  // component. This mirrors searchStudents in search.functions.ts.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const cached = cache["landing-stats"];
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;

  const [studentsRes, classroomsRes, collegesRes, solvedRes, platformsRes] =
    await Promise.allSettled([
      // Omitting the argument entirely — the regenerated types reject an
      // explicit null (see classrooms.functions.ts:70-74).
      supabaseAdmin.rpc("distinct_student_count"),
      supabaseAdmin.from("classrooms").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("colleges").select("*", { count: "exact", head: true }),
      // PostgREST has no sum(); .range() mirrors MAX_ROWS in overview.functions.ts
      // so the default db-max-rows can't silently truncate the sum.
      supabaseAdmin
        .from("student_stats")
        .select("total_solved")
        .range(0, MAX_ROWS - 1),
      supabaseAdmin.from("platforms").select("*", { count: "exact", head: true }),
    ]);

  let problemsSolved: number | null = null;
  if (solvedRes.status === "fulfilled" && !solvedRes.value.error) {
    problemsSolved = (solvedRes.value.data ?? []).reduce(
      (sum, row) => sum + Number(row.total_solved ?? 0),
      0,
    );
  }

  const value: LandingStats = {
    students: studentsRes.status === "fulfilled" ? Number(studentsRes.value.data ?? 0) : null,
    classrooms: classroomsRes.status === "fulfilled" ? (classroomsRes.value.count ?? null) : null,
    colleges: collegesRes.status === "fulfilled" ? (collegesRes.value.count ?? null) : null,
    problemsSolved,
    platforms: platformsRes.status === "fulfilled" ? (platformsRes.value.count ?? null) : null,
    generatedAt: new Date().toISOString(),
  };

  if (value.students !== null || value.problemsSolved !== null) {
    cache["landing-stats"] = { at: Date.now(), value };
  }
  return value;
});
