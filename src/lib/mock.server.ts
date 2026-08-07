// Server-only: build the demo cohort.
//
// Lives in a .server.ts because it reaches for supabaseAdmin. mock.functions.ts
// is imported by the dashboard route, so an exported plain function there would
// drag the service-role client into the browser bundle — the same trap that
// caught loadCohortPlatformStats and platform-capabilities.
//
// Extracted so it has TWO callers: the dashboard button (via the server fn) and
// the CRON_SECRET-gated route in api/public/cron/seed-demo. The function already
// accepted CRON_SECRET as an auth gate; nothing had ever exposed it.

/**
 * Create the demo classroom, its students and their platform data.
 *
 * Idempotent: returns the existing cohort untouched if it is already there.
 * `userId` is the creator, used only to resolve which college to file the
 * cohort under; null for an unattended (cron/script) run.
 */
export async function seedDemoClassroom(
  userId: string | null,
): Promise<{ id: string; created: boolean }> {
  // Authorisation is the CALLER's job — the server fn checks admin-or-cron, the
  // cron route checks the secret. Duplicating it here would mean two places to
  // get it wrong.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const name = "Demo Cohort — CSE 2026";
  const { data: existing } = await supabaseAdmin
    .from("classrooms")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (existing) return { id: existing.id, created: false };

  /*
      Which college the demo cohort belongs to.

      resolveCollegeId THROWS on a multi-college install with no hint, which is
      the right call for a real classroom — filing a cohort under the wrong
      institution corrupts every rank derived from it. But it made "Try demo
      data" fail outright with "Multiple colleges exist", which is a dead end for
      a button whose whole job is to work with no setup.

      So demo data gets its own college. That is not a workaround, it is the
      honest answer: fake students must not inflate a real institution's
      leaderboard, and a self-contained college is deletable in one step.
    */
  const collegeId = await resolveDemoCollegeId(userId);

  const { data: cls, error } = await supabaseAdmin
    .from("classrooms")
    .insert({
      name,
      college_id: collegeId,
      description: "Auto-generated demo classroom with fake data — safe to delete.",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const students = generateMockStudents();
  const { data: rows, error: sErr } = await supabaseAdmin
    .from("students")
    .insert(
      students.map((s) => ({
        name: s.name,
        roll: s.roll,
        email: s.email,
        leetcode_id: s.leetcode_id,
        last_scraped_at: new Date().toISOString(),
      })),
    )
    .select("id");
  if (sErr) throw new Error(sErr.message);

  // Membership is a separate row now. Without it these students belong to no
  // classroom, so nothing would list them and the worker would never scrape them.
  const { error: memErr } = await supabaseAdmin
    .from("classroom_students")
    .insert((rows ?? []).map((r) => ({ student_id: r.id, classroom_id: cls.id })));
  if (memErr) throw new Error(memErr.message);

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

  await seedDemoPlatforms(rows ?? [], students);

  return { id: cls.id, created: true };
}

/**
 * Give the demo cohort accounts on the other platforms, with stats and history.
 *
 * Three tables, because the UI reads three different things and showing only one
 * of them is what makes a page look half-broken:
 *   student_platform_accounts — the handle, which drives the profile's platform
 *                               strip and the "coverage" figures
 *   platform_stats            — the numbers behind every lens and table
 *   daily_snapshots           — the 30-day trend, which is otherwise "no history"
 *
 * Best-effort throughout: the demo classroom and its LeetCode data are already
 * committed by this point, and failing the whole seed because one platform row
 * collided would leave a half-made cohort behind.
 */
async function seedDemoPlatforms(
  rows: { id: string }[],
  students: ReturnType<typeof generateMockStudents>,
): Promise<void> {
  if (rows.length === 0) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const studentIds = rows.map((r) => r.id);

  /*
    LeetCode first, and separately, because its account row is not ours to make:
    the students_sync_leetcode_account trigger (20260808000002) created it off
    the insert above. What is missing is its platform_stats row — the backfill in
    that migration was one-time, so a student created afterwards has an account
    with no stats behind it and the profile strip reads "not fetched yet" for the
    one platform the demo definitely has data for.
  */
  const { data: lcAccounts } = await supabaseAdmin
    .from("student_platform_accounts")
    .select("id, student_id")
    .eq("platform_id", "leetcode")
    .in("student_id", studentIds);

  if (lcAccounts?.length) {
    const byStudent = new Map(rows.map((r, i) => [r.id, students[i]]));
    await supabaseAdmin.from("platform_stats").upsert(
      lcAccounts.map((a) => {
        const s = byStudent.get(a.student_id);
        return {
          account_id: a.id,
          student_id: a.student_id,
          platform_id: "leetcode",
          total_solved: s?.total ?? 0,
          easy_solved: s?.easy ?? 0,
          medium_solved: s?.medium ?? 0,
          hard_solved: s?.hard ?? 0,
          streak: s?.streak ?? 0,
          fetch_status: "success",
          fetched_at: new Date().toISOString(),
          data: {},
        };
      }),
      { onConflict: "account_id" },
    );
  }

  // Only platforms that actually exist in this database — the seed list is a
  // superset of what a given install has enabled.
  const { data: known } = await supabaseAdmin
    .from("platforms")
    .select("id")
    .in(
      "id",
      DEMO_PLATFORMS.map((p) => p.id),
    );
  const available = new Set((known ?? []).map((p) => p.id));
  const platforms = DEMO_PLATFORMS.filter((p) => available.has(p.id));
  if (platforms.length === 0) return;

  type Account = { student_id: string; platform_id: string; handle: string; status: string };
  const accounts: Account[] = [];

  for (let i = 0; i < rows.length; i++) {
    const s = students[i];
    if (!s) continue;
    for (const p of platforms) {
      // Not everyone is on every site — ~70% coverage, so "Coverage" and
      // "without a handle" are exercised rather than always reading 100%.
      if (Math.random() > 0.7) continue;
      accounts.push({
        student_id: rows[i].id,
        platform_id: p.id,
        handle: `${p.handlePrefix}_${s.leetcode_id}`,
        status: "active",
      });
    }
  }
  if (accounts.length === 0) return;

  const { data: created, error: acctErr } = await supabaseAdmin
    .from("student_platform_accounts")
    .insert(accounts)
    .select("id, student_id, platform_id");
  if (acctErr || !created) return;

  const solvedFor = new Map(rows.map((r, i) => [r.id, students[i]?.total ?? 100]));
  const now = new Date().toISOString();

  const stats = created.map((a) => {
    const meta = platforms.find((p) => p.id === a.platform_id)!;
    // Scaled off the student's LeetCode volume so a strong student reads strong
    // everywhere — an independent random per platform would make the "who is
    // best overall" comparison meaningless, which is the point of the score.
    const base = solvedFor.get(a.student_id) ?? 100;
    const solved = Math.max(1, Math.round(base * (0.3 + Math.random() * 0.5)));
    const easy = Math.round(solved * 0.5);
    const medium = Math.round(solved * 0.35);

    return {
      account_id: a.id,
      student_id: a.student_id,
      platform_id: a.platform_id,
      total_solved: solved,
      // Difficulty split only where the platform publishes one. HackerRank and
      // CodeChef report none, so their whole count is unrated — the UI reads
      // exactly this to choose a histogram over a donut.
      easy_solved: meta.id === "codeforces" || meta.id === "geeksforgeeks" ? easy : null,
      medium_solved: meta.id === "codeforces" || meta.id === "geeksforgeeks" ? medium : null,
      hard_solved:
        meta.id === "codeforces" || meta.id === "geeksforgeeks" ? solved - easy - medium : null,
      unrated_solved: meta.id === "hackerrank" || meta.id === "codechef" ? solved : null,
      rating: meta.metric === "rating" ? Math.round(900 + base * 2.2 + Math.random() * 200) : null,
      max_rating:
        meta.metric === "rating" ? Math.round(1000 + base * 2.3 + Math.random() * 250) : null,
      platform_score: meta.metric === "score" ? Math.round(base * 4 + Math.random() * 400) : null,
      global_rank: Math.floor(1000 + Math.random() * 90_000),
      contests_attended: Math.floor(Math.random() * 20),
      fetch_status: "success",
      fetched_at: now,
      data: {},
    };
  });

  await supabaseAdmin.from("platform_stats").insert(stats);

  /*
    Thirty days of history, so the trend chart has something to draw. Cumulative
    totals with a per-day delta, matching what the real worker writes — a flat
    series would exercise the "no history" path instead of the chart.
  */
  const snapshots: {
    student_id: string;
    platform_id: string;
    snapshot_date: string;
    total_solved: number;
    solved_that_day: number;
  }[] = [];

  for (const st of stats) {
    let running = Math.max(0, st.total_solved - 30);
    for (let d = 29; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
      const gained = Math.random() < 0.45 ? Math.floor(Math.random() * 3) : 0;
      running += gained;
      snapshots.push({
        student_id: st.student_id,
        platform_id: st.platform_id,
        snapshot_date: day,
        total_solved: running,
        solved_that_day: gained,
      });
    }
  }

  // Chunked: 25 students x 4 platforms x 30 days is ~3000 rows, past what one
  // PostgREST request should carry.
  for (let i = 0; i < snapshots.length; i += 500) {
    await supabaseAdmin.from("daily_snapshots").upsert(snapshots.slice(i, i + 500), {
      onConflict: "student_id,platform_id,snapshot_date",
      ignoreDuplicates: true,
    });
  }
}

// ---------- helpers ----------

const DEMO_COLLEGE_NAME = "Demo College";
const DEMO_COLLEGE_SLUG = "demo-college";

/**
 * A college for the demo cohort, created on first use.
 *
 * Order matters. If the install has exactly one college, use it — a single-tenant
 * setup wants its demo data where everything else is, and inventing a second
 * college there would be noise. Only once the answer is genuinely ambiguous does
 * this fall back to a dedicated demo college rather than throwing.
 */
async function resolveDemoCollegeId(userId: string | null | undefined): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  try {
    const { resolveCollegeId } = await import("./colleges.server");
    return await resolveCollegeId({ userId });
  } catch {
    /* ambiguous — fall through to the demo college */
  }

  const { data: existing } = await supabaseAdmin
    .from("colleges")
    .select("id")
    .eq("slug", DEMO_COLLEGE_SLUG)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from("colleges")
    .insert({ name: DEMO_COLLEGE_NAME, slug: DEMO_COLLEGE_SLUG })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the demo college: ${error.message}`);
  return created.id;
}

/**
 * Platforms the demo seeds, and how to fake a plausible number for each.
 *
 * The seed used to write student_stats only — LeetCode. So the demo could never
 * exercise the platform lens, the per-platform tables, or the profile page's
 * platform strip: every one of those correctly rendered "nothing here" and it
 * looked like the feature was broken rather than unseeded.
 *
 * Values follow each platform's real metric, because that is what the UI keys
 * off: a rating platform with a solved count and no rating would sort and band
 * as unrated.
 */
const DEMO_PLATFORMS = [
  { id: "codeforces", metric: "rating" as const, handlePrefix: "cf" },
  { id: "codechef", metric: "rating" as const, handlePrefix: "cc" },
  { id: "geeksforgeeks", metric: "score" as const, handlePrefix: "gfg" },
  { id: "hackerrank", metric: "score" as const, handlePrefix: "hr" },
];

const firstNames = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Diya",
  "Anaya",
  "Ishaan",
  "Kabir",
  "Aanya",
  "Reyansh",
  "Sara",
  "Arjun",
  "Myra",
  "Vihaan",
  "Aarohi",
  "Krishna",
  "Anika",
  "Rohan",
  "Nisha",
  "Sameer",
  "Priya",
  "Rahul",
  "Meera",
  "Karan",
  "Tanvi",
  "Zoya",
];
const lastNames = [
  "Sharma",
  "Verma",
  "Patel",
  "Reddy",
  "Nair",
  "Iyer",
  "Gupta",
  "Singh",
  "Kumar",
  "Das",
  "Rao",
  "Menon",
  "Chopra",
  "Kapoor",
  "Bose",
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
      activity === "top"
        ? 500 + Math.floor(Math.random() * 300)
        : activity === "high"
          ? 250 + Math.floor(Math.random() * 200)
          : activity === "mid"
            ? 100 + Math.floor(Math.random() * 120)
            : activity === "low"
              ? 30 + Math.floor(Math.random() * 60)
              : 0 + Math.floor(Math.random() * 15);
    const easy = Math.floor(base * 0.5);
    const medium = Math.floor(base * 0.4);
    const hard = base - easy - medium;
    const streak =
      activity === "top"
        ? 30 + Math.floor(Math.random() * 90)
        : activity === "high"
          ? 10 + Math.floor(Math.random() * 25)
          : activity === "mid"
            ? 2 + Math.floor(Math.random() * 8)
            : activity === "low"
              ? Math.floor(Math.random() * 3)
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
    activity === "top"
      ? 0.85
      : activity === "high"
        ? 0.55
        : activity === "mid"
          ? 0.28
          : activity === "low"
            ? 0.08
            : 0;
  // avg count when active
  const mean = activity === "top" ? 4 : activity === "high" ? 2.5 : activity === "mid" ? 1.5 : 1;
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
