import { createFileRoute } from "@tanstack/react-router";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cron/refresh")({
  server: {
    handlers: {
      POST: async () => {
        try {
          requireCronSecret();
        } catch {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { fetchLeetCodeProfile } = await import("@/lib/leetcode.server");

        const { data: students, error } = await supabaseAdmin
          .from("students")
          .select("id, leetcode_id");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const runId = crypto.randomUUID();
        try {
          await supabaseAdmin.from("scrape_runs").insert({
            id: runId, source: "cron", started_at: new Date().toISOString(), total_students: (students ?? []).length,
          });
        } catch {}

        let ok = 0;
        let failed = 0;
        const errors: string[] = [];
        for (const s of students ?? []) {
          try {
            const p = await fetchLeetCodeProfile(s.leetcode_id);
            await supabaseAdmin.from("student_stats").upsert({
              student_id: s.id,
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

            const dateStr = new Date().toISOString().slice(0, 10);
            const { data: prev } = await supabaseAdmin
              .from("daily_snapshots")
              .select("total_solved")
              .eq("student_id", s.id)
              .lt("snapshot_date", dateStr)
              .order("snapshot_date", { ascending: false })
              .limit(1)
              .maybeSingle();
            const solvedThatDay = Math.max(0, p.totalSolved - (prev?.total_solved ?? p.totalSolved));
            await supabaseAdmin.from("daily_snapshots").upsert({
              student_id: s.id,
              snapshot_date: dateStr,
              total_solved: p.totalSolved,
              easy_solved: p.easySolved,
              medium_solved: p.mediumSolved,
              hard_solved: p.hardSolved,
              solved_that_day: solvedThatDay,
            });

            await supabaseAdmin.from("recent_submissions").delete().eq("student_id", s.id);
            if (p.recent.length) {
              await supabaseAdmin.from("recent_submissions").insert(
                p.recent.map((r) => ({
                  student_id: s.id,
                  title: r.title,
                  title_slug: r.titleSlug,
                  lang: r.lang,
                  submitted_at: r.submittedAt,
                })),
              );
            }

            await supabaseAdmin
              .from("students")
              .update({ last_scraped_at: new Date().toISOString(), scrape_error: null })
              .eq("id", s.id);
            ok += 1;
          } catch (e: any) {
            errors.push(String(e?.message ?? e).slice(0, 200));
            await supabaseAdmin
              .from("students")
              .update({ last_scraped_at: new Date().toISOString(), scrape_error: String(e?.message ?? e).slice(0, 300) })
              .eq("id", s.id);
            failed += 1;
          }
          await new Promise((r) => setTimeout(r, 300));
        }

        try {
          await supabaseAdmin.from("scrape_runs").update({
            completed_at: new Date().toISOString(), success_count: ok, failed_count: failed, errors: errors.length ? JSON.stringify(errors.slice(0, 20)) : null,
          }).eq("id", runId);
        } catch {}

        return Response.json({ ok, failed, total: (students ?? []).length });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run refresh" }),
    },
  },
});
