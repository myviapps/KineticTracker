#!/usr/bin/env node
/**
 * Seeds a demo college + cohort whose handles are REAL and public, so a refresh
 * returns genuine multi-platform data instead of invented numbers.
 *
 * Why real handles: the Almanac Score is difficulty-weighted across platforms
 * with different scales, and per-platform ranks depend on rating vs solved-count
 * semantics. Fabricated stats look plausible and hide exactly the bugs this is
 * meant to surface — you cannot tell a broken weight from a made-up number.
 *
 * Why its own college: ranks are per-college, so demo data in "Demo Institute"
 * cannot distort CMRTC's real standings.
 *
 * Idempotent — re-running updates in place rather than duplicating.
 *
 *   node scripts/seed-mock-multiplatform.mjs          # seed
 *   node scripts/seed-mock-multiplatform.mjs --purge  # remove it all again
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

const URL_ = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const upsert = (table, rows, onConflict) =>
  rest(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });

const COLLEGE = { name: "Demo Institute", slug: "demo-institute", city: "Hyderabad" };
const CLASSROOM = "Demo Cohort — Multi-Platform";

/**
 * Every handle below was verified live before being committed.
 *
 * The last two students carry deliberately invalid LeetCode handles. That is not
 * an oversight: students.leetcode_id is still NOT NULL, real cohorts always
 * contain a few typos, and the UI needs a way to see what a parked
 * invalid_handle account actually looks like.
 */
const ROSTER = [
  [
    "Aarav Sharma",
    "DEMO001",
    {
      leetcode: "votrubac",
      codeforces: "tourist",
      codechef: "gennady.korotkevich",
      hackerrank: "tourist",
    },
  ],
  [
    "Diya Patel",
    "DEMO002",
    { leetcode: "lee215", codeforces: "Petr", codechef: "uwi", geeksforgeeks: "codewithsathya" },
  ],
  [
    "Rohan Verma",
    "DEMO003",
    {
      leetcode: "StefanPochmann",
      codeforces: "Benq",
      codechef: "anton_lunyov",
      hackerrank: "abhiranjan",
    },
  ],
  [
    "Ananya Reddy",
    "DEMO004",
    {
      leetcode: "wisdompeak",
      codeforces: "Um_nik",
      codechef: "kevinsogo",
      hackerrank: "kevinsogo",
    },
  ],
  [
    "Vihaan Nair",
    "DEMO005",
    { leetcode: "cuiaoxiang", codeforces: "ecnerwala", codechef: "rajarshi_basu" },
  ],
  [
    "Ishita Rao",
    "DEMO006",
    {
      leetcode: "hiepit",
      codeforces: "jiangly",
      hackerrank: "dheeraj_2016",
      geeksforgeeks: "sandeepjain2",
    },
  ],
  [
    "Arjun Menon",
    "DEMO007",
    { leetcode: "awice", codeforces: "Radewoosh", hackerrank: "shashank21j" },
  ],
  [
    "Saanvi Iyer",
    "DEMO008",
    { leetcode: "tiantian1412", codeforces: "ksun48", geeksforgeeks: "harshitkant" },
  ],
  ["Kabir Singh", "DEMO009", { leetcode: "mhmdsalah", codeforces: "maroonrk" }],
  ["Myra Gupta", "DEMO010", { leetcode: "neal_wu", codeforces: "Errichto" }],
  ["Advait Joshi", "DEMO011", { leetcode: "demo_typo_no_such_user_1", codeforces: "scott_wu" }],
  ["Kiara Desai", "DEMO012", { leetcode: "demo_typo_no_such_user_2", codeforces: "mnbvmar" }],
];

const PLATFORMS_USED = ["leetcode", "codeforces", "codechef", "hackerrank", "geeksforgeeks"];

async function purge() {
  const [college] = await rest(`colleges?slug=eq.${COLLEGE.slug}&select=id`);
  if (!college) return console.log("nothing to purge");
  const rolls = ROSTER.map((r) => r[1]);
  // students cascade to accounts, stats, snapshots and memberships.
  await rest(`students?roll=in.(${rolls.join(",")})`, { method: "DELETE" });
  await rest(`classrooms?college_id=eq.${college.id}`, { method: "DELETE" });
  await rest(`colleges?id=eq.${college.id}`, { method: "DELETE" });
  console.log("purged Demo Institute, its cohort and all its students");
}

async function seed() {
  const [college] = await upsert("colleges", [COLLEGE], "slug");
  console.log(`college  ${college.name} (${college.id.slice(0, 8)})`);

  let [classroom] = await rest(
    `classrooms?name=eq.${encodeURIComponent(CLASSROOM)}&college_id=eq.${college.id}&select=id,name`,
  );
  if (!classroom) {
    [classroom] = await rest("classrooms", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          name: CLASSROOM,
          description: "Seeded demo cohort. Handles are real public profiles so stats are genuine.",
          college_id: college.id,
        },
      ]),
    });
  }
  console.log(`cohort   ${classroom.name} (${classroom.id.slice(0, 8)})`);

  const students = await upsert(
    "students",
    ROSTER.map(([name, roll, handles]) => ({
      name,
      roll,
      email: `${roll.toLowerCase()}@demo.institute`,
      leetcode_id: handles.leetcode,
    })),
    "roll",
  );
  const byRoll = new Map(students.map((s) => [s.roll, s]));
  console.log(`students ${students.length}`);

  await upsert(
    "classroom_students",
    students.map((s) => ({ classroom_id: classroom.id, student_id: s.id })),
    "classroom_id,student_id",
  );

  // The sync trigger already created the leetcode account rows from
  // students.leetcode_id; only the other platforms need inserting.
  const accounts = [];
  for (const [, roll, handles] of ROSTER) {
    const student = byRoll.get(roll);
    for (const [platform_id, handle] of Object.entries(handles)) {
      if (platform_id === "leetcode") continue;
      accounts.push({ student_id: student.id, platform_id, handle, status: "unverified" });
    }
  }
  await upsert("student_platform_accounts", accounts, "student_id,platform_id");
  console.log(
    `accounts ${accounts.length + students.length} across ${PLATFORMS_USED.length} platforms`,
  );

  // student_scores only counts enabled platforms, so the demo data cannot score
  // until these are on.
  await rest(`platforms?id=in.(${PLATFORMS_USED.join(",")})`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
  });
  console.log(`enabled  ${PLATFORMS_USED.join(", ")}`);

  const counts = {};
  for (const p of PLATFORMS_USED) {
    const r = await fetch(
      `${URL_}/rest/v1/student_platform_accounts?select=id&platform_id=eq.${p}&student_id=in.(${students.map((s) => s.id).join(",")})`,
      { headers: { ...H, Prefer: "count=exact", Range: "0-0" } },
    );
    counts[p] = Number(r.headers.get("content-range")?.split("/")[1] ?? 0);
  }
  console.log("\ncoverage:", JSON.stringify(counts));
  console.log("\nNext: refresh each platform, e.g.");
  console.log("  select enqueue_platform_refresh_job('codeforces');  -- then pump");
}

await (process.argv.includes("--purge") ? purge() : seed());
