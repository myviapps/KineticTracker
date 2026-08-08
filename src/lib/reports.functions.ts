import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { authContext, withRole, accessibleClassroomIds } from "@/lib/authz";

/**
 * Report data for one or many classrooms / colleges.
 *
 * Returns plain JSON; the workbook is assembled in the browser
 * (see report-workbook.ts). A college-wide export is tens of thousands of rows,
 * and building the .xlsx inside a Vercel function would put a large
 * serialise-and-stream job under the same 60s ceiling this project has already
 * had to fight twice. The browser has no such limit.
 */

const Input = z.object({
  classroomIds: z.array(z.string().uuid()).max(200).optional(),
  collegeIds: z.array(z.string().uuid()).max(50).optional(),
  platformIds: z.array(z.string().min(1).max(50)).max(20).optional(),
  days: z.number().int().min(0).max(365).default(30),
});

/** Refuse rather than truncate past this many fact rows. */
const MAX_FACT_ROWS = 100_000;

/**
 * Explicit fetch ceiling for the daily-history sheet.
 *
 * Held at MAX_FACT_ROWS so the export obeys one limit rather than two: past this
 * point the request is too large either way, and the check above is what turns
 * that into a refusal instead of a short sheet. Stating it also overrides
 * PostgREST's default db-max-rows, which is 1000 and truncates in silence.
 */
const MAX_ROWS = MAX_FACT_ROWS;

export type ReportScope = {
  colleges: { id: string; name: string }[];
  classrooms: { id: string; name: string; college_id: string | null }[];
  platforms: { id: string; name: string; rank_metric: string }[];
  days: number;
  generatedAt: string;
};

export type ReportSummaryPlatform = {
  platform_id: string;
  platform_name: string;
  rank_metric: string;
  students: number;
  coverage_pct: number;
  avg_metric: number | null;
  total_solved: number;
  top_student: string | null;
  top_value: number | null;
};

export type ReportRosterRow = Record<string, string | number | null>;
export type ReportFactRow = Record<string, string | number | null>;
export type ReportDailyRow = Record<string, string | number | null>;

export const buildReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withRole])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    /*
      Scope resolution.

      `allowed === null` means unrestricted (admin / placement officer). Every
      requested classroom is intersected against it, so a hand-crafted request
      naming someone else's cohort returns nothing rather than data. A CEO's
      multi-college report must never include a college they cannot open.
    */
    const allowed = await accessibleClassroomIds(userId, role);

    let classroomQuery = supabaseAdmin.from("classrooms").select("id, name, college_id");
    if (data.classroomIds?.length) classroomQuery = classroomQuery.in("id", data.classroomIds);
    if (data.collegeIds?.length) classroomQuery = classroomQuery.in("college_id", data.collegeIds);
    if (allowed !== null) {
      if (allowed.length === 0) return emptyReport(data.days);
      classroomQuery = classroomQuery.in("id", allowed);
    }

    const { data: classrooms, error: clsErr } = await classroomQuery;
    if (clsErr) throw new Error(clsErr.message);
    if (!classrooms?.length) return emptyReport(data.days);

    const classroomIds = classrooms.map((c) => c.id);
    const collegeIds = [
      ...new Set(classrooms.map((c) => c.college_id).filter(Boolean)),
    ] as string[];

    const { data: colleges } = collegeIds.length
      ? await supabaseAdmin.from("colleges").select("id, name").in("id", collegeIds)
      : { data: [] as { id: string; name: string }[] };
    const collegeName = new Map((colleges ?? []).map((c) => [c.id, c.name]));
    const classroomOf = new Map(classrooms.map((c) => [c.id, c]));

    // Membership. A student in two selected cohorts appears once in Roster but
    // carries both classroom names, so no row is silently dropped or doubled.
    const { data: memberships } = await supabaseAdmin
      .from("classroom_students")
      .select("student_id, classroom_id")
      .in("classroom_id", classroomIds);

    const cohortsByStudent = new Map<string, string[]>();
    for (const m of memberships ?? []) {
      const list = cohortsByStudent.get(m.student_id) ?? [];
      list.push(m.classroom_id);
      cohortsByStudent.set(m.student_id, list);
    }
    const studentIds = [...cohortsByStudent.keys()];
    if (studentIds.length === 0) return emptyReport(data.days);

    const [{ data: students }, { data: accounts }, { data: platformRows }] = await Promise.all([
      supabaseAdmin.from("students").select("id, name, roll, email").in("id", studentIds),
      supabaseAdmin
        .from("student_platform_accounts")
        .select("id, student_id, platform_id, handle, status, last_fetched_at")
        .in("student_id", studentIds),
      supabaseAdmin
        .from("platforms")
        .select("id, name, rank_metric, sort_order")
        .order("sort_order"),
    ]);

    const wantPlatform = (id: string) => !data.platformIds?.length || data.platformIds.includes(id);
    const accts = (accounts ?? []).filter((a) => wantPlatform(a.platform_id));

    if (accts.length > MAX_FACT_ROWS) {
      // Refusing beats truncating: a report that quietly drops half a college is
      // worse than one that says it is too large.
      throw new Error(
        `This selection produces ${accts.length.toLocaleString()} rows, over the ${MAX_FACT_ROWS.toLocaleString()} limit. Narrow the classrooms or platforms.`,
      );
    }

    const { data: stats } = accts.length
      ? await supabaseAdmin
          .from("platform_stats")
          .select(
            "account_id, platform_id, total_solved, easy_solved, medium_solved, hard_solved, unrated_solved, rating, max_rating, global_rank, country_rank, institute_rank, platform_score, stars, streak, contests_attended, fetch_status, fetched_at",
          )
          .in(
            "account_id",
            accts.map((a) => a.id),
          )
      : { data: [] };

    const statByAccount = new Map((stats ?? []).map((s) => [s.account_id, s]));
    const studentById = new Map((students ?? []).map((s) => [s.id, s]));

    const usedPlatformIds = [...new Set(accts.map((a) => a.platform_id))];
    const platforms = (platformRows ?? [])
      .filter((p) => usedPlatformIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name, rank_metric: p.rank_metric ?? "solved" }));

    const { fetchStudentRanks } = await import("@/lib/ranks.server");
    const ranks = await fetchStudentRanks(studentIds);

    const metricOf = (s: Record<string, number | null> | undefined, m: string) =>
      !s
        ? null
        : m === "rating"
          ? s.rating
          : m === "score"
            ? (s.platform_score ?? s.total_solved)
            : s.total_solved;

    const cohortNames = (sid: string) =>
      (cohortsByStudent.get(sid) ?? [])
        .map((cid) => classroomOf.get(cid)?.name ?? "")
        .filter(Boolean);
    const collegeFor = (sid: string) => {
      const first = (cohortsByStudent.get(sid) ?? [])[0];
      const cid = first ? classroomOf.get(first)?.college_id : null;
      return cid ? (collegeName.get(cid) ?? "") : "";
    };

    // ── Summary ──────────────────────────────────────────────────────────────
    const summaryPlatforms: ReportSummaryPlatform[] = platforms.map((p) => {
      const mine = accts.filter((a) => a.platform_id === p.id);
      const values = mine
        .map((a) => metricOf(statByAccount.get(a.id) as never, p.rank_metric))
        .filter((v): v is number => typeof v === "number");
      const best = mine
        .map((a) => ({
          name: studentById.get(a.student_id)?.name ?? "",
          v: metricOf(statByAccount.get(a.id) as never, p.rank_metric),
        }))
        .filter((x) => x.v !== null)
        .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))[0];

      return {
        platform_id: p.id,
        platform_name: p.name,
        rank_metric: p.rank_metric,
        students: mine.length,
        coverage_pct: studentIds.length ? Math.round((mine.length / studentIds.length) * 100) : 0,
        avg_metric: values.length
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : null,
        total_solved: mine.reduce(
          (a, x) => a + ((statByAccount.get(x.id)?.total_solved as number) ?? 0),
          0,
        ),
        top_student: best?.name ?? null,
        top_value: best?.v ?? null,
      };
    });

    // ── Roster: one row per student, a column pair per platform ──────────────
    const roster: ReportRosterRow[] = studentIds.map((sid) => {
      const st = studentById.get(sid);
      const r = ranks.get(sid);
      const row: ReportRosterRow = {
        College: collegeFor(sid),
        Classrooms: cohortNames(sid).join(" | "),
        Student: st?.name ?? "",
        Roll: st?.roll ?? "",
        Email: st?.email ?? "",
        "Almanac Score": r ? Math.round(r.almanac_score) : null,
        "College Rank": r?.college_rank ?? null,
        "College Of": r?.college_total ?? null,
        Platforms: accts.filter((a) => a.student_id === sid).length,
      };
      for (const p of platforms) {
        const acc = accts.find((a) => a.student_id === sid && a.platform_id === p.id);
        const s = acc ? statByAccount.get(acc.id) : undefined;
        row[`${p.name} Handle`] = acc?.handle ?? "";
        row[`${p.name} (${p.rank_metric})`] = metricOf(s as never, p.rank_metric);
      }
      return row;
    });

    // ── Fact: one row per (student × platform), the pivot source ────────────
    const fact: ReportFactRow[] = accts.map((a) => {
      const st = studentById.get(a.student_id);
      const s = statByAccount.get(a.id);
      const r = ranks.get(a.student_id);
      const pr = r?.platform_ranks.find((x) => x.platform_id === a.platform_id);
      return {
        College: collegeFor(a.student_id),
        Classrooms: cohortNames(a.student_id).join(" | "),
        Student: st?.name ?? "",
        Roll: st?.roll ?? "",
        Platform: platforms.find((p) => p.id === a.platform_id)?.name ?? a.platform_id,
        Handle: a.handle,
        Status: a.status,
        Solved: s?.total_solved ?? null,
        Easy: s?.easy_solved ?? null,
        Medium: s?.medium_solved ?? null,
        Hard: s?.hard_solved ?? null,
        Unrated: s?.unrated_solved ?? null,
        Rating: s?.rating ?? null,
        "Max Rating": s?.max_rating ?? null,
        Score: s?.platform_score ?? null,
        Stars: s?.stars ?? null,
        Streak: s?.streak ?? null,
        Contests: s?.contests_attended ?? null,
        "Global Rank": s?.global_rank ?? null,
        "Platform Rank In College": pr?.college_rank ?? null,
        "Almanac Score": r ? Math.round(r.almanac_score) : null,
        "Fetch Status": s?.fetch_status ?? "never",
        "Last Fetched": a.last_fetched_at ?? "",
      };
    });

    // ── Daily history ────────────────────────────────────────────────────────
    let daily: ReportDailyRow[] = [];
    if (data.days > 0) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - data.days);
      const { data: snaps } = await supabaseAdmin
        .from("daily_snapshots")
        .select("student_id, platform_id, snapshot_date, total_solved, solved_that_day")
        .in("student_id", studentIds)
        .gte("snapshot_date", since.toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: true })
        // PostgREST's default db-max-rows silently truncates. An export is the
        // worst place to lose rows quietly: the sheet looks complete, and the
        // missing days are the RECENT ones because this orders ascending.
        .range(0, MAX_ROWS - 1);

      daily = (snaps ?? [])
        .filter((s) => wantPlatform(s.platform_id))
        .map((s) => ({
          Date: s.snapshot_date,
          College: collegeFor(s.student_id),
          Student: studentById.get(s.student_id)?.name ?? "",
          Roll: studentById.get(s.student_id)?.roll ?? "",
          Platform: platforms.find((p) => p.id === s.platform_id)?.name ?? s.platform_id,
          "Total Solved": s.total_solved,
          "Solved That Day": s.solved_that_day,
        }));
    }

    const scores = studentIds.map((sid) => ranks.get(sid)?.almanac_score ?? 0);

    return {
      scope: {
        colleges: (colleges ?? []).map((c) => ({ id: c.id, name: c.name })),
        classrooms: classrooms.map((c) => ({ id: c.id, name: c.name, college_id: c.college_id })),
        platforms,
        days: data.days,
        generatedAt: new Date().toISOString(),
      } satisfies ReportScope,
      totals: {
        students: studentIds.length,
        classrooms: classrooms.length,
        colleges: (colleges ?? []).length,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        totalSolved: fact.reduce((a, f) => a + ((f.Solved as number) ?? 0), 0),
      },
      summaryPlatforms,
      roster,
      fact,
      daily,
    };
  });

function emptyReport(days: number) {
  return {
    scope: {
      colleges: [],
      classrooms: [],
      platforms: [],
      days,
      generatedAt: new Date().toISOString(),
    } satisfies ReportScope,
    totals: { students: 0, classrooms: 0, colleges: 0, avgScore: 0, totalSolved: 0 },
    summaryPlatforms: [] as ReportSummaryPlatform[],
    roster: [] as ReportRosterRow[],
    fact: [] as ReportFactRow[],
    daily: [] as ReportDailyRow[],
  };
}

/** Classrooms and colleges the caller may pick from, for the export dialog. */
export const listReportScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withRole])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, role } = authContext(context);

    const allowed = await accessibleClassroomIds(userId, role);
    if (allowed !== null && allowed.length === 0) return { colleges: [], classrooms: [] };

    let q = supabaseAdmin.from("classrooms").select("id, name, college_id").order("name");
    if (allowed !== null) q = q.in("id", allowed);
    const { data: classrooms } = await q;

    const collegeIds = [
      ...new Set((classrooms ?? []).map((c) => c.college_id).filter(Boolean)),
    ] as string[];
    const { data: colleges } = collegeIds.length
      ? await supabaseAdmin.from("colleges").select("id, name").in("id", collegeIds).order("name")
      : { data: [] as { id: string; name: string }[] };

    return {
      colleges: colleges ?? [],
      classrooms: (classrooms ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        college_id: c.college_id,
      })),
    };
  });
