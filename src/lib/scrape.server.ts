// Server-only helper: scrape a single student and persist stats.
// Reused by students.functions and bulk-import.functions.
export async function scrapeStudentById(id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { fetchLeetCodeProfile } = await import("./leetcode.server");

  const { data: student, error } = await supabaseAdmin
    .from("students")
    .select("id, leetcode_id, consecutive_failures")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!student) throw new Error("Student not found");

  try {
    const p = await fetchLeetCodeProfile(student.leetcode_id);

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
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
