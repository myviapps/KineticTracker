/**
 * Standalone LeetCode fetch diagnostic. No app imports, no build step.
 *
 *   node scripts/diagnose-leetcode.mjs                 # 5 students, fetch only
 *   node scripts/diagnose-leetcode.mjs --n 10          # 10 students
 *   node scripts/diagnose-leetcode.mjs --write         # also time the DB writes
 *   node scripts/diagnose-leetcode.mjs --batches 3     # simulate 3 full batches
 *   node scripts/diagnose-leetcode.mjs --classroom <uuid>
 *
 * Answers three questions the app cannot currently answer for itself:
 *   1. Can we reach LeetCode at all, or are we being blocked?
 *   2. How long does one student actually take, call by call?
 *   3. At batch-of-5 + 3s cooldown, what is the real throughput?
 */
import fs from "node:fs";

// ── env ───────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const SB = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const N = Number(arg("n", 5));
const BATCH_SIZE = Number(arg("batch", 5));
const COOLDOWN_MS = Number(arg("cooldown", 3000));
const BATCHES = Number(arg("batches", 1));
const DO_WRITE = has("write");
const CLASSROOM = arg("classroom", null);

// ── tiny console helpers ──────────────────────────────────────────────────
const C = {
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  grn: (s) => `\x1b[32m${s}\x1b[0m`,
  yel: (s) => `\x1b[33m${s}\x1b[0m`,
  cyn: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const t0 = Date.now();
const stamp = () => C.dim(`[${String((Date.now() - t0) / 1000).padStart(6, " ")}s]`);
const log = (...a) => console.log(stamp(), ...a);
const ms = (n) => `${n}ms`;
const sleep = (n) => new Promise((r) => setTimeout(r, n));

// ── LeetCode GraphQL (mirrors src/lib/leetcode.server.ts) ─────────────────
const LC_URL = "https://leetcode.com/graphql";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; Almanac/1.0; +https://almanac.example)",
  Referer: "https://leetcode.com/",
};

const PROFILE_QUERY = `query userPublicProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { realName userAvatar countryName reputation ranking }
    submitStatsAll: submitStats {
      acSubmissionNum { difficulty count submissions }
      totalSubmissionNum { difficulty count submissions }
    }
    languageProblemCount { languageName problemsSolved }
    tagProblemCounts {
      advanced { tagName problemsSolved }
      intermediate { tagName problemsSolved }
      fundamental { tagName problemsSolved }
    }
    badges { id displayName icon creationDate }
  }
  allQuestionsCount { difficulty count }
  userContestRanking(username: $username) {
    attendedContestsCount rating globalRanking totalParticipants topPercentage
  }
}`;

const CALENDAR_QUERY = `query userProfileCalendar($username: String!, $year: Int) {
  matchedUser(username: $username) {
    userCalendar(year: $year) { activeYears streak totalActiveDays submissionCalendar }
  }
}`;

const RECENT_QUERY = `query recentAcSubmissions($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id title titleSlug timestamp lang
  }
}`;

/** One GraphQL call, fully instrumented. Never throws — returns a report. */
async function gqlTimed(label, username, query, variables) {
  const started = Date.now();
  try {
    const res = await fetch(LC_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12_000),
    });
    const elapsed = Date.now() - started;
    const ct = res.headers.get("content-type") || "";
    const retryAfter = res.headers.get("retry-after");

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      const cloudflare = /cloudflare|cf-ray|just a moment/i.test(body) || !ct.includes("json");
      return {
        label, ok: false, elapsed, status: res.status,
        kind: res.status === 429 || res.status === 403 || res.status === 503 ? "THROTTLE" : "FAIL",
        note: cloudflare ? "Cloudflare challenge (HTML body)" : body,
        retryAfter,
      };
    }
    const json = await res.json();
    if (json.errors?.length) {
      return { label, ok: false, elapsed, status: res.status, kind: "GRAPHQL_ERROR", note: json.errors.map((e) => e.message).join("; ").slice(0, 160) };
    }
    return { label, ok: true, elapsed, status: res.status, data: json.data };
  } catch (e) {
    const elapsed = Date.now() - started;
    const isAbort = e?.name === "AbortError" || e?.name === "TimeoutError";
    return {
      label, ok: false, elapsed, status: 0,
      kind: isAbort ? "TIMEOUT" : "NETWORK",
      note: isAbort ? "aborted after 12s" : String(e?.message ?? e).slice(0, 160),
    };
  }
}

/** All three calls for one student, serialized exactly like the app does. */
async function fetchStudentTimed(student) {
  const { leetcode_id: username } = student;
  const started = Date.now();
  const calls = [];

  const p = await gqlTimed("profile", username, PROFILE_QUERY, { username });
  calls.push(p);
  await sleep(250);

  const c = await gqlTimed("calendar", username, CALENDAR_QUERY, {
    username,
    year: new Date().getUTCFullYear(),
  });
  calls.push(c);
  await sleep(250);

  const r = await gqlTimed("recent", username, RECENT_QUERY, { username, limit: 20 });
  calls.push(r);

  const total = Date.now() - started;
  const failed = calls.filter((x) => !x.ok);
  const notFound = p.ok && !p.data?.matchedUser;
  const solved = p.ok
    ? p.data?.matchedUser?.submitStatsAll?.acSubmissionNum?.find((x) => x.difficulty === "All")?.count
    : null;

  return { student, username, calls, total, failed, notFound, solved };
}

// ── Supabase write timing (mirrors scrapeStudentById) ─────────────────────
async function timeWrite(studentId, r) {
  const started = Date.now();
  const steps = [];
  const step = async (name, fn) => {
    const s = Date.now();
    let ok = true, note = "";
    try { const res = await fn(); if (res && res.status >= 400) { ok = false; note = `HTTP ${res.status} ${(await res.text()).slice(0,120)}`; } }
    catch (e) { ok = false; note = String(e?.message ?? e).slice(0, 120); }
    steps.push({ name, elapsed: Date.now() - s, ok, note });
  };

  const mu = r.calls[0].data?.matchedUser;
  const cal = r.calls[1].data?.matchedUser?.userCalendar;
  const ac = mu?.submitStatsAll?.acSubmissionNum ?? [];
  const pick = (d) => ac.find((x) => x.difficulty === d)?.count ?? 0;

  await step("student_stats upsert", () =>
    fetch(`${SUPABASE_URL}/rest/v1/student_stats?on_conflict=student_id`, {
      method: "POST",
      headers: { ...SB, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        student_id: studentId,
        real_name: mu?.profile?.realName ?? null,
        avatar: mu?.profile?.userAvatar ?? null,
        total_solved: pick("All"),
        easy_solved: pick("Easy"),
        medium_solved: pick("Medium"),
        hard_solved: pick("Hard"),
        streak: cal?.streak ?? 0,
        total_active_days: cal?.totalActiveDays ?? 0,
        submission_calendar: cal?.submissionCalendar ? JSON.parse(cal.submissionCalendar) : {},
        updated_at: new Date().toISOString(),
      }),
    }));

  await step("daily_snapshots prev select", () =>
    fetch(`${SUPABASE_URL}/rest/v1/daily_snapshots?select=total_solved&student_id=eq.${studentId}&order=snapshot_date.desc&limit=1`, { headers: SB }));

  await step("students update", () =>
    fetch(`${SUPABASE_URL}/rest/v1/students?id=eq.${studentId}`, {
      method: "PATCH",
      headers: { ...SB, Prefer: "return=minimal" },
      body: JSON.stringify({ last_scraped_at: new Date().toISOString(), scrape_error: null, consecutive_failures: 0 }),
    }));

  return { total: Date.now() - started, steps };
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(C.bold("\n═══ LeetCode fetch diagnostic ═══"));
  console.log(C.dim(`batch=${BATCH_SIZE}  cooldown=${COOLDOWN_MS}ms  batches=${BATCHES}  write=${DO_WRITE}\n`));

  // 1. Pull students
  let q = `${SUPABASE_URL}/rest/v1/students?select=id,name,roll,leetcode_id&order=id.asc&limit=${N}`;
  if (CLASSROOM) q += `&classroom_id=eq.${CLASSROOM}`;
  const sres = await fetch(q, { headers: SB });
  const students = await sres.json();
  if (!Array.isArray(students) || !students.length) {
    console.error(C.red("No students found."), students);
    process.exit(1);
  }
  log(C.cyn(`Loaded ${students.length} students from Supabase`));

  // 2. Connectivity probe
  log(C.cyn("Probing leetcode.com ..."));
  const probe = await gqlTimed("probe", students[0].leetcode_id, RECENT_QUERY, {
    username: students[0].leetcode_id, limit: 1,
  });
  if (probe.ok) {
    log(C.grn(`  reachable — ${ms(probe.elapsed)}`));
  } else {
    log(C.red(`  ${probe.kind} status=${probe.status} ${ms(probe.elapsed)} — ${probe.note}`));
    if (probe.retryAfter) log(C.red(`  retry-after: ${probe.retryAfter}s`));
    console.log(C.red("\nLeetCode is not answering. Everything below will fail for the same reason.\n"));
  }

  // 3. Batched runs
  const perStudent = [];
  const perBatch = [];
  let throttled = 0;

  for (let b = 0; b < BATCHES; b++) {
    const slice = students.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    if (!slice.length) break;

    console.log(C.bold(`\n── batch ${b + 1}/${BATCHES} — ${slice.length} students concurrently ──`));
    const bStart = Date.now();
    const results = await Promise.all(slice.map((s) => fetchStudentTimed(s)));
    const bFetch = Date.now() - bStart;

    for (const r of results) {
      perStudent.push(r);
      const detail = r.calls.map((c) => `${c.label}:${c.ok ? C.grn(ms(c.elapsed)) : C.red(`${c.kind}/${ms(c.elapsed)}`)}`).join("  ");
      const head = r.failed.length === 0 && !r.notFound
        ? C.grn("OK  ")
        : r.notFound ? C.yel("404 ") : C.red("FAIL");
      log(`  ${head} ${String(r.username).padEnd(22)} ${String(ms(r.total)).padStart(7)}   ${detail}`);
      for (const f of r.failed) {
        if (f.kind === "THROTTLE") throttled++;
        log(C.red(`         └─ ${f.label}: ${f.kind} ${f.status} — ${f.note ?? ""}`));
      }
      if (r.notFound) log(C.yel(`         └─ leetcode_id "${r.username}" does not exist (student: ${r.student.name} / ${r.student.roll})`));
    }

    let bWrite = 0;
    if (DO_WRITE) {
      const wStart = Date.now();
      const writes = await Promise.all(
        results.filter((r) => r.calls[0].ok && !r.notFound).map((r) => timeWrite(r.student.id, r)),
      );
      bWrite = Date.now() - wStart;
      const slowest = writes.flatMap((w) => w.steps).sort((a, b2) => b2.elapsed - a.elapsed)[0];
      log(C.cyn(`  writes: ${ms(bWrite)} for ${writes.length} students`) + (slowest ? C.dim(`  (slowest step: ${slowest.name} ${ms(slowest.elapsed)})`) : ""));
      for (const w of writes) for (const s of w.steps) if (!s.ok) log(C.red(`         └─ write FAIL ${s.name}: ${s.note}`));
    }

    perBatch.push({ fetch: bFetch, write: bWrite, total: bFetch + bWrite });
    log(C.bold(`  batch wall: ${ms(bFetch + bWrite)}`));

    const isLast = b === BATCHES - 1 || (b + 1) * BATCH_SIZE >= students.length;
    if (!isLast) {
      log(C.dim(`  cooldown ${COOLDOWN_MS}ms ...`));
      await sleep(COOLDOWN_MS);
    }
  }

  // 4. Verdict
  const okCount = perStudent.filter((r) => r.failed.length === 0 && !r.notFound).length;
  const nf = perStudent.filter((r) => r.notFound).length;
  const avgStudent = Math.round(perStudent.reduce((s, r) => s + r.total, 0) / Math.max(1, perStudent.length));
  const avgBatch = Math.round(perBatch.reduce((s, b) => s + b.total, 0) / Math.max(1, perBatch.length));
  const period = avgBatch + COOLDOWN_MS;
  const perMin = Math.round((BATCH_SIZE / period) * 60_000);
  const reqPerMin = Math.round((BATCH_SIZE * 3 / period) * 60_000);

  console.log(C.bold("\n═══ Verdict ═══"));
  console.log(`  students attempted : ${perStudent.length}`);
  console.log(`  succeeded          : ${okCount === perStudent.length ? C.grn(okCount) : C.yel(okCount)}`);
  console.log(`  bad leetcode_id    : ${nf ? C.yel(nf) : 0}`);
  console.log(`  throttled calls    : ${throttled ? C.red(throttled) : C.grn(0)}`);
  console.log(`  avg per student    : ${ms(avgStudent)}  ${C.dim("(3 serial calls + 500ms of built-in sleeps)")}`);
  console.log(`  avg batch wall     : ${ms(avgBatch)} for ${BATCH_SIZE} concurrent`);
  console.log(`  batch period       : ${ms(period)} ${C.dim(`(wall + ${COOLDOWN_MS}ms cooldown)`)}`);
  console.log(C.bold(`  throughput         : ~${perMin} students/min   (~${reqPerMin} req/min at LeetCode)`));
  console.log(`  projected 135      : ${C.cyn(fmtDur((135 / BATCH_SIZE) * period))}`);
  console.log(`  projected 1000     : ${C.cyn(fmtDur((1000 / BATCH_SIZE) * period))}`);

  const chunkBudget = 44_000;
  const batchesPerChunk = Math.floor(chunkBudget / period);
  console.log(`\n  At a 50s chunk budget, one invocation completes ${C.bold(batchesPerChunk)} batches ` +
    `= ${C.bold(batchesPerChunk * BATCH_SIZE)} students.`);
  if (avgBatch > chunkBudget) {
    console.log(C.red(`  ⚠ One batch (${ms(avgBatch)}) exceeds the whole chunk budget — the worker can never commit.`));
  }
  console.log("");
})();

function fmtDur(msTotal) {
  const s = Math.round(msTotal / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
