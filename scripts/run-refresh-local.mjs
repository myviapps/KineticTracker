/**
 * Drive a refresh job to completion against the local dev server, with timings.
 * Bounded by --max-minutes so it can never hang the terminal.
 *
 *   npm run dev                                  # in another terminal
 *   node scripts/run-refresh-local.mjs           # first classroom
 *   node scripts/run-refresh-local.mjs --classroom <uuid>
 *   node scripts/run-refresh-local.mjs --platform
 *   node scripts/run-refresh-local.mjs --resume   # drive the existing active job
 *   node scripts/run-refresh-local.mjs --max-minutes 5
 *
 * Watch the dev-server terminal for the per-batch [chunk] / [scrape] logs.
 */
import fs from "node:fs";

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
const U = env.SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const CRON = env.CRON_SECRET;
if (!U || !K) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }
if (!CRON) { console.error("Missing CRON_SECRET in .env (see .env.example)"); process.exit(1); }

const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

const BASE = arg("base", "http://localhost:3000");
const MAX_MIN = Number(arg("max-minutes", 25));
const MAX_CHUNKS = Number(arg("max-chunks", 200));

const C = {
  dim: (s) => `\x1b[90m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  grn: (s) => `\x1b[32m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m`,
  cyn: (s) => `\x1b[36m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (ms) => { const s = Math.round(ms / 1000); const m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; };

const t0 = Date.now();
const el = () => C.dim(`[t+${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`);

// ── clock skew check — this silently broke leasing once already ────────────
async function checkSkew() {
  const a = Date.now();
  const r = await fetch(`${U}/rest/v1/scrape_runs`, {
    method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ source: "student", total_students: 0 }),
  });
  const b = Date.now();
  const row = (await r.json())[0];
  if (!row) return 0;
  await fetch(`${U}/rest/v1/scrape_runs?id=eq.${row.id}`, { method: "DELETE", headers: H });
  const skew = new Date(row.started_at).getTime() - (a + b) / 2;
  const abs = Math.abs(skew);
  console.log(
    `  clock skew (db - local): ${abs > 5000 ? C.red(`${Math.round(skew / 1000)}s`) : C.grn(`${Math.round(skew)}ms`)}`,
  );
  if (abs > 5000) {
    console.log(C.yel("  ⚠ Your machine's clock differs from the database by more than 5s."));
    console.log(C.yel("    Leases are compared with the Postgres clock, so keep app-side"));
    console.log(C.yel("    timestamps out of lease logic. Consider syncing system time."));
  }
  return skew;
}

(async () => {
  console.log(C.bold("\n═══ local refresh runner ═══"));
  await checkSkew();

  // 1. Get or create the job
  let jobId;
  if (has("resume")) {
    const active = await (await fetch(
      `${U}/rest/v1/refresh_jobs?select=id,status,processed,total&status=in.(queued,running,paused)&order=created_at.desc&limit=1`,
      { headers: H },
    )).json();
    if (!active.length) { console.error(C.red("No active job to resume.")); process.exit(1); }
    jobId = active[0].id;
    console.log(`  resuming ${jobId.slice(0, 8)} — ${active[0].processed}/${active[0].total}`);
  } else {
    const scope = has("platform") ? "platform" : "classroom";
    let classroomId = arg("classroom", null);
    if (scope === "classroom" && !classroomId) {
      const cls = (await (await fetch(`${U}/rest/v1/classrooms?select=id,name&limit=1`, { headers: H })).json())[0];
      if (!cls) { console.error(C.red("No classrooms found.")); process.exit(1); }
      classroomId = cls.id;
      console.log(`  classroom: ${cls.name} ${C.dim(cls.id)}`);
    }
    jobId = await (await fetch(`${U}/rest/v1/rpc/enqueue_refresh_job`, {
      method: "POST", headers: H,
      body: JSON.stringify({ p_scope: scope, p_classroom_id: classroomId ?? undefined, p_filter: "all" }),
    })).json();
    console.log(`  enqueued ${C.cyn(String(jobId).slice(0, 8))} scope=${scope}`);
  }

  // 2. Drive chunks
  const deadline = t0 + MAX_MIN * 60_000;
  let chunk = 0, idle = 0, last = 0;

  while (Date.now() < deadline && chunk < MAX_CHUNKS) {
    let res;
    try {
      const r = await fetch(`${BASE}/api/public/jobs/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON}` },
        body: JSON.stringify({ jobId }),
        signal: AbortSignal.timeout(120_000),
      });
      if (r.status === 401) { console.error(C.red("  401 — CRON_SECRET mismatch between .env and the running dev server. Restart `npm run dev`.")); process.exit(1); }
      res = await r.json();
    } catch (e) {
      console.log(`${el()} ${C.red("request failed")} ${String(e?.message ?? e).slice(0, 120)}`);
      idle++; if (idle > 15) { console.log(C.red("  giving up after 15 failures")); break; }
      await sleep(4000); continue;
    }

    if (res.claimed === false) {
      if (res.jobStatus && !["queued", "running", "paused"].includes(res.jobStatus)) {
        console.log(`${el()} job is ${C.yel(res.jobStatus)} — stopping`);
        break;
      }
      idle++;
      if (idle > 20) { console.log(C.red("  lease never released — stopping")); break; }
      process.stdout.write(`${el()} ${C.dim(`lease held (${res.jobStatus}), waiting…`)}\r`);
      await sleep(4000);
      continue;
    }

    idle = 0; chunk++;
    const gained = res.processed - last; last = res.processed;
    const pct = res.total ? Math.round((res.processed / res.total) * 100) : 0;
    console.log(
      `${el()} chunk ${String(chunk).padStart(2)}  ` +
      `${C.grn(`+${gained}`)}  ${C.bold(`${res.processed}/${res.total}`)} (${pct}%)  ` +
      `${C.dim(`ok=${res.succeeded} fail=${res.failed}`)}`,
    );

    if (res.done) { console.log(C.grn(`\n✔ COMPLETE in ${dur(Date.now() - t0)} — ${res.succeeded} updated, ${res.failed} failed`)); break; }
    if (res.paused) { console.log(C.yel("\n⏸ paused — rate limited, will resume automatically")); break; }
  }

  if (Date.now() >= deadline) console.log(C.yel(`\n⏱ hit --max-minutes ${MAX_MIN} cap; re-run with --resume to continue`));

  const j = (await (await fetch(`${U}/rest/v1/refresh_jobs?select=status,processed,succeeded,failed,total&id=eq.${jobId}`, { headers: H })).json())[0];
  console.log(C.bold("\nfinal: ") + `${j.status}  ${j.processed}/${j.total}  ok=${j.succeeded} fail=${j.failed}`);
  const rate = j.processed / ((Date.now() - t0) / 60000);
  if (j.processed) console.log(C.dim(`rate: ~${Math.round(rate)} students/min → 1000 students ≈ ${dur((1000 / rate) * 60000)}`));
  console.log("");
})();
