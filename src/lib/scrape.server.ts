// Server-only helper: scrape a single student and persist stats.
// Reused by students.functions and bulk-import.functions.
//
// `deadline` is an epoch-ms ceiling for the enclosing chunk. Omit it for
// interactive single-student refreshes, which have no batch budget to protect.
export async function scrapeStudentById(id: string, deadline?: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { fetchLeetCodeProfile } = await import("./leetcode.server");
  const { log } = await import("./log.server");
  const tStart = Date.now();

  const { data: student, error } = await supabaseAdmin
    .from("students")
    .select("id, leetcode_id, consecutive_failures")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    log.error("scrape", `student lookup failed for ${id.slice(0, 8)}`, error);
    throw new Error(error.message);
  }
  if (!student) throw new Error("Student not found");

  try {
    const tFetch = Date.now();
    const p = await fetchLeetCodeProfile(student.leetcode_id, deadline);
    const fetchMs = Date.now() - tFetch;

    await supabaseAdmin.from("student_stats").upsert({
      student_id: id,
      real_name: p.realName,
      avatar: p.avatar,
      country: p.country,
      reputation: p.reputation,
      ranking: p.ranking,
      total_solved: p.totalSolved,
      total_questions: p.totalQuestions,
      easy_solved: p.easySolved,
      easy_total: p.easyTotal,
      medium_solved: p.mediumSolved,
      medium_total: p.mediumTotal,
      hard_solved: p.hardSolved,
      hard_total: p.hardTotal,
      acceptance_rate: p.acceptanceRate,
      streak: p.streak,
      total_active_days: p.totalActiveDays,
      contest_rating: p.contestRating,
      contest_global_ranking: p.contestGlobalRanking,
      contests_attended: p.contestsAttended,
      contest_top_percentage: p.contestTopPercentage,
      submission_calendar: p.submissionCalendar,
      language_stats: p.languageStats,
      tag_stats: p.tagStats,
      badges: p.badges,
      updated_at: new Date().toISOString(),
    });

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    let prev: { total_solved: number } | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("daily_snapshots")
        .select("total_solved")
        .eq("student_id", id)
        // Scoped to the platform, not just the student. daily_snapshots has been
        // keyed (student_id, platform_id, snapshot_date) since the platform_stats
        // migration, so without this the newest row for a student can belong to
        // Codeforces and this diffs a LeetCode total against it — a delta that is
        // not a delta of anything. The current writer in platform-stats.server.ts
        // already filters; this legacy path never got the fix.
        .eq("platform_id", "leetcode")
        .lt("snapshot_date", dateStr)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      prev = data;
    } catch {
      /* prev stays null — safe default */
    }
    const solvedThatDay = Math.max(0, p.totalSolved - (prev?.total_solved ?? p.totalSolved));
    try {
      await supabaseAdmin.from("daily_snapshots").upsert({
        student_id: id,
        platform_id: "leetcode",
        snapshot_date: dateStr,
        total_solved: p.totalSolved,
        easy_solved: p.easySolved,
        medium_solved: p.mediumSolved,
        hard_solved: p.hardSolved,
        solved_that_day: solvedThatDay,
      });
    } catch {
      /* snapshot non-critical — already have stats */
    }

    try {
      await supabaseAdmin.from("recent_submissions").delete().eq("student_id", id);
      if (p.recent.length) {
        await supabaseAdmin.from("recent_submissions").insert(
          p.recent.map((r) => ({
            student_id: id,
            title: r.title,
            title_slug: r.titleSlug,
            lang: r.lang,
            submitted_at: r.submittedAt,
          })),
        );
      }
    } catch {
      /* recent submissions non-critical */
    }

    await supabaseAdmin
      .from("students")
      .update({
        last_scraped_at: new Date().toISOString(),
        scrape_error: null,
        consecutive_failures: 0,
      })
      .eq("id", id);

    log.info(
      "scrape",
      `  ✓ ${student.leetcode_id} solved=${p.totalSolved} fetch=${fetchMs}ms db=${Date.now() - tFetch - fetchMs}ms total=${Date.now() - tStart}ms`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    // A budget abort means WE ran out of chunk time, not that the handle is
    // bad. Leave the student row completely untouched so the penalty counter
    // stays clean and the next run picks them up as if nothing happened —
    // counting this as a failure would eventually park a perfectly valid
    // handle at FAILURE_CUTOFF.
    const kind = (e as { kind?: string } | null)?.kind;
    if (kind === "budget") {
      log.warn("scrape", `  ⏱ ${student.leetcode_id} skipped — chunk budget exhausted`);
      throw e;
    }

    log.error("scrape", `  ✕ ${student.leetcode_id} after ${Date.now() - tStart}ms`, e);
    // Track repeat offenders so the worker can skip permanently-broken handles
    // (typo'd leetcode_id) instead of burning a request on them every run.
    await supabaseAdmin
      .from("students")
      .update({
        last_scraped_at: new Date().toISOString(),
        scrape_error: msg.slice(0, 300),
        consecutive_failures: (student.consecutive_failures ?? 0) + 1,
      })
      .eq("id", id);
    throw e;
  }
}
