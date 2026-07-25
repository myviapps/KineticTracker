import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCronSecret } from "@/integrations/supabase/cron-auth";

// Seed a mock classroom with fake but realistic-looking student stats
// so users can preview the UI without any scraping.
export const seedMockClassroom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Accept CRON_SECRET as an alternative gate to admin auth.
    let isCron = false;
    try {
      requireCronSecret();
      isCron = true;
    } catch {}

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    if (!isCron) {
      // Admins only — this writes to shared classroom/student tables.
      const { data: role } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (role?.role !== "admin") throw new Error("Forbidden");
    }

    const name = "Demo Cohort — CSE 2026";
    const { data: existing } = await supabaseAdmin
      .from("classrooms")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (existing) return { id: existing.id, created: false };

    const { data: cls, error } = await supabaseAdmin
      .from("classrooms")
      .insert({
        name,
        description:
          "Auto-generated demo classroom with fake data — safe to delete.",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const students = generateMockStudents();
    const { data: rows, error: sErr } = await supabaseAdmin
      .from("students")
      .insert(
        students.map((s) => ({
          classroom_id: cls.id,
          name: s.name,
          roll: s.roll,
          email: s.email,
          leetcode_id: s.leetcode_id,
          last_scraped_at: new Date().toISOString(),
        })),
      )
      .select("id");
    if (sErr) throw new Error(sErr.message);

    // Insert fake stats
    const statsRows = (rows ?? []).map((r, i) => {
      const s = students[i];
      const cal = buildFakeCalendar(s.activity);
      return {
        student_id: r.id,
        real_name: s.name,
        avatar: null,
        country: "India",
        reputation: Math.floor(s.total / 10),
        ranking: 500000 - s.total * 800 + Math.floor(Math.random() * 5000),
        total_solved: s.total,
        total_questions: 3300,
        easy_solved: s.easy,
        easy_total: 850,
        medium_solved: s.medium,
        medium_total: 1750,
        hard_solved: s.hard,
        hard_total: 700,
        acceptance_rate: 55 + Math.random() * 30,
        streak: s.streak,
        total_active_days: Math.min(365, Math.floor(s.total / 1.5)),
        contest_rating: 1400 + Math.random() * 500,
        contest_global_ranking: 100000 + Math.floor(Math.random() * 200000),
        contests_attended: Math.floor(Math.random() * 15),
        contest_top_percentage: Math.random() * 40,
        submission_calendar: cal,
        language_stats: [
          { languageName: "Python3", problemsSolved: Math.floor(s.total * 0.5) },
          { languageName: "C++", problemsSolved: Math.floor(s.total * 0.3) },
          { languageName: "Java", problemsSolved: Math.floor(s.total * 0.2) },
        ],
        tag_stats: {
          advanced: [
            { tagName: "Dynamic Programming", problemsSolved: Math.floor(s.total * 0.15) },
            { tagName: "Graph", problemsSolved: Math.floor(s.total * 0.08) },
          ],
          intermediate: [
            { tagName: "Tree", problemsSolved: Math.floor(s.total * 0.12) },
            { tagName: "Binary Search", problemsSolved: Math.floor(s.total * 0.1) },
          ],
          fundamental: [
            { tagName: "Array", problemsSolved: Math.floor(s.total * 0.25) },
            { tagName: "String", problemsSolved: Math.floor(s.total * 0.18) },
            { tagName: "Hash Table", problemsSolved: Math.floor(s.total * 0.14) },
          ],
        },
        badges: [],
        updated_at: new Date().toISOString(),
      };
    });
    await supabaseAdmin.from("student_stats").insert(statsRows);

    // Recent submissions
    const problems = [
      ["Two Sum", "two-sum"],
      ["Add Two Numbers", "add-two-numbers"],
      ["Longest Substring", "longest-substring-without-repeating-characters"],
      ["Median of Sorted Arrays", "median-of-two-sorted-arrays"],
      ["Container With Most Water", "container-with-most-water"],
      ["3Sum", "3sum"],
      ["Valid Parentheses", "valid-parentheses"],
      ["Merge Two Sorted Lists", "merge-two-sorted-lists"],
      ["Trapping Rain Water", "trapping-rain-water"],
      ["Word Break", "word-break"],
    ];
    const langs = ["python3", "cpp", "java"];
    const subs: Array<{
      student_id: string;
      title: string;
      title_slug: string;
      lang: string;
      submitted_at: string;
    }> = [];
    for (const r of rows ?? []) {
      const n = 5 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) {
        const [title, slug] = problems[Math.floor(Math.random() * problems.length)];
        const daysAgo = Math.floor(Math.random() * 14);
        const dt = new Date(Date.now() - daysAgo * 86_400_000);
        subs.push({
          student_id: r.id,
          title,
          title_slug: slug,
          lang: langs[Math.floor(Math.random() * langs.length)],
          submitted_at: dt.toISOString(),
        });
      }
    }
    if (subs.length) await supabaseAdmin.from("recent_submissions").insert(subs);

    return { id: cls.id, created: true };
  },
);

// ---------- helpers ----------

const firstNames = [
  "Aarav","Vivaan","Aditya","Diya","Anaya","Ishaan","Kabir","Aanya","Reyansh",
  "Sara","Arjun","Myra","Vihaan","Aarohi","Krishna","Anika","Rohan","Nisha",
  "Sameer","Priya","Rahul","Meera","Karan","Tanvi","Zoya",
];
const lastNames = [
  "Sharma","Verma","Patel","Reddy","Nair","Iyer","Gupta","Singh","Kumar","Das",
  "Rao","Menon","Chopra","Kapoor","Bose",
];

function generateMockStudents() {
  const out: {
    name: string;
    roll: string;
    email: string;
    leetcode_id: string;
    total: number;
    easy: number;
    medium: number;
    hard: number;
    streak: number;
    activity: "top" | "high" | "mid" | "low" | "silent";
  }[] = [];
  for (let i = 0; i < 25; i++) {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const name = `${fn} ${ln}`;
    const roll = `CSE-26-${String(i + 1).padStart(3, "0")}`;
    // Distribution: 3 top / 6 high / 9 mid / 5 low / 2 silent
    let activity: (typeof out)[number]["activity"];
    if (i < 3) activity = "top";
    else if (i < 9) activity = "high";
    else if (i < 18) activity = "mid";
    else if (i < 23) activity = "low";
    else activity = "silent";
    const base =
      activity === "top" ? 500 + Math.floor(Math.random() * 300)
      : activity === "high" ? 250 + Math.floor(Math.random() * 200)
      : activity === "mid" ? 100 + Math.floor(Math.random() * 120)
      : activity === "low" ? 30 + Math.floor(Math.random() * 60)
      : 0 + Math.floor(Math.random() * 15);
    const easy = Math.floor(base * 0.5);
    const medium = Math.floor(base * 0.4);
    const hard = base - easy - medium;
    const streak =
      activity === "top" ? 30 + Math.floor(Math.random() * 90)
      : activity === "high" ? 10 + Math.floor(Math.random() * 25)
      : activity === "mid" ? 2 + Math.floor(Math.random() * 8)
      : activity === "low" ? Math.floor(Math.random() * 3)
      : 0;
    out.push({
      name,
      roll,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@demo.edu`,
      leetcode_id: `${fn.toLowerCase()}_${ln.toLowerCase()}`,
      total: base,
      easy,
      medium,
      hard,
      streak,
      activity,
    });
  }
  return out;
}

function buildFakeCalendar(
  activity: "top" | "high" | "mid" | "low" | "silent",
): Record<string, number> {
  // p(active) per day
  const p =
    activity === "top" ? 0.85
    : activity === "high" ? 0.55
    : activity === "mid" ? 0.28
    : activity === "low" ? 0.08
    : 0;
  // avg count when active
  const mean =
    activity === "top" ? 4
    : activity === "high" ? 2.5
    : activity === "mid" ? 1.5
    : 1;
  const cal: Record<string, number> = {};
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const ts = Math.floor(d.getTime() / 1000);
    if (Math.random() < p) {
      const n = Math.max(1, Math.round(mean + (Math.random() - 0.5) * 2));
      cal[String(ts)] = n;
    }
  }
  return cal;
}
