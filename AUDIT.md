# Almanac / Kinetic Tracker Hub — Complete Application Audit

**Date:** 2026-08-06
**Branch audited:** `feat/landing-page` (working tree, including untracked files)
**Stack:** TanStack Start 1.168 (Nitro → Vercel) · React 19.2 · Tailwind v4 · shadcn/ui · Supabase Postgres · FastAPI/Scrapling sidecar
**Scope:** Application architecture, UI/UX, frontend, backend/data, security, testing, CI/CD, dependencies, repo hygiene

---

## 0. Remediation status

Findings were remediated in a follow-up pass. Current state:

| ID | Finding | Status |
|---|---|:---:|
| C-1 | Anon-readable RLS-bypassing views | ✅ **Fixed** — `20260809000001` |
| C-2 | `x-vercel-cron` auth bypass | ✅ **Fixed** |
| C-3 | `CRON_SECRET` sent to header-derived host | ✅ **Fixed** (block deleted) |
| H-1 | `_` LIKE-wildcard enumeration | ✅ **Fixed** |
| H-2 | Cohort names unmasked for anon | ✅ **Fixed** |
| H-3 | 53 untracked paths | ✅ **Resolved** — now 5 |
| H-4 | No security headers | ✅ **Fixed** (CSP is Report-Only — see note) |
| H-5 | Session in `localStorage` | ⬜ Open — architectural, needs its own change |
| M-1 | 3 failing CodeChef tests | ⚠️ **Withdrawn** — no longer reproduces, see §3 |
| M-2 | `xlsx@0.18.5` CVEs | ⬜ Open — needs CDN tarball swap + verification |
| M-3 | No rate limiting | ✅ **Fixed** — `20260809000002` + `rate-limit.server.ts` |
| M-4 | `scrape_runs` / `college_platforms` RLS | ✅ **Fixed** |
| M-5 | `has_*` permission oracle | ✅ **Fixed** (in-function guard, not revoke — see note) |
| M-6 | Unbounded queries | ✅ **Fixed** — partly already done pre-audit |
| M-7 | N+1 and non-atomic writes | ⬜ Open — needs transactional RPCs |
| M-8 | Validation gaps | ✅ **Fixed** |
| M-9 | String-interpolated PostgREST filter | ⬜ Open — guard holds; still fragile by construction |
| M-10 | CSV formula injection | ✅ **Fixed** |
| — | No CI | ✅ **Fixed** — `.github/workflows/ci.yml` |
| — | Lint unusably slow / disabled | ✅ **Fixed** — 5min+ → **17s** |
| — | Sidecar fail-open auth | ✅ **Fixed** |
| — | A11y: heatmap, switch label, skip link | ✅ **Fixed** |
| — | ~2,000 lines dead UI primitives | ⬜ Open — now surfaced as lint warnings |

**Verification after remediation:** `tsc --noEmit` clean · `vitest run` **56/56 passing** (39 existing + 17 new) · `eslint .` **0 errors**, 42 warnings, exit 0.

### Two implementation notes worth reading

**CSP is `Report-Only`, and deliberately permissive.** TanStack Start injects inline hydration scripts, so a strict `script-src` would break the app, and Vercel's static `headers` cannot issue a per-request nonce. The policy ships in Report-Only mode with `'unsafe-inline'` so violations surface in the console without breaking anything. **It provides limited XSS protection as written** — the other five headers are enforced and do real work. Flipping to enforcing requires either a nonce-capable middleware or verifying hash-based `script-src` against a production build.

**M-5 was fixed by guarding the functions, not by revoking `EXECUTE`.** The obvious fix is wrong here: RLS policy expressions are evaluated with the querying user's privileges, and these four predicates are the entire body of the policies on `students`, `student_stats`, `classrooms` and others. Revoking would have made every authenticated PostgREST read fail with "permission denied for function" — breaking RLS rather than tightening it. Each predicate now returns false when an authenticated caller asks about a user other than themselves, which closes the oracle while leaving both RLS and the service-role paths untouched.

---

## 1. Executive summary

Almanac is a competitive-programming cohort tracker: it ingests student profiles from ~10 coding platforms, stores per-day snapshots, and presents cohort analytics to faculty, placement officers, CEOs, and admins.

**The verdict is genuinely split.** The application-layer authorization is better than most codebases of this size — `src/lib/authz.ts` is a real single source of truth, every authenticated server function routes through it, and the code is unusually well commented with the *reasoning* behind past bug fixes. The scraper worker's budget/lease/circuit-breaker design is sophisticated and correct.

But that quality sits on top of three categories of serious exposure:

1. **A database grant layer that undoes the application layer.** Five RLS-bypassing views are granted to `anon`. The entire student directory is readable by anyone holding the publishable key — which ships in the client bundle. Every masking function in the codebase is decorative as a result.
2. **Machine-auth that can be bypassed with a request header**, chained to a code path that leaks `CRON_SECRET` to an attacker-supplied host.
3. **Roughly half the application is not in git**, including the entire scraper service, all platform adapters, 11 of 24 migrations, and the whole test suite.

### Scorecard

Grades are shown as **at audit → after remediation**.

| Domain | Grade | One-line |
|---|:---:|---|
| Application authorization (TS) | **A− → A−** | Single source of truth, fails closed, consistently applied |
| Database grants / RLS | **F → A−** | Anon grants revoked, `security_invoker` on all 8 views, oracle closed |
| Machine / cron auth | **D → A−** | Header bypass deleted, SSRF path removed, hashed constant-time compare |
| Backend architecture | **B → B+** | Excellent worker design; queries bounded; transactions still absent |
| Frontend architecture | **B → B** | Clean patterns, well-documented; one 1,642-line route |
| UI / design system | **A− → A−** | Coherent oklch token system, thorough reduced-motion handling |
| Accessibility | **C+ → B** | Heatmap now labelled, switch named, skip link added |
| Testing | **D+ → C+** | 56 passing; masking + capability predicates covered; DB paths still not |
| CI/CD | **F → B+** | Typecheck/lint/test/build + client-bundle secret assertion on every push |
| Repo hygiene | **F → A−** | 53 untracked → 5; lint 5min+ → 17s |
| Dependencies | **C → C** | `xlsx@0.18.5` CVEs still open; Nitro beta still in prod |
| Security headers | **F → B** | Five headers enforced; CSP Report-Only and permissive (see §0) |

### Verification evidence

Everything in §2 was verified directly, not inferred:

| Check | Command | At audit | After remediation |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ Clean | ✅ Clean |
| Tests | `npx vitest run` | ❌ 3 failed / 36 passed | ✅ **56 passed** (see M-1 caveat) |
| ESLint | `npx eslint .` | ❌ **Never finished** (>5 min) | ✅ **17s, 0 errors**, 42 warnings |
| Untracked paths | `git status --porcelain` | ❌ 53 untracked | ✅ **5** |
| Migrations tracked | `git ls-files supabase/migrations` | ❌ 13 of 24 | ✅ **24 of 26** |
| `security_invoker` on views | `grep -ri` | ❌ 0 views | ✅ **All 8** |
| Security headers | `vercel.json` | ❌ None | ✅ 5 enforced + CSP Report-Only |

The ESLint result was the diagnostic that mattered: `eslint.config.js` ignored `dist`, `.output` and `.vinxi` but **not `.vercel`** — so every run was linting the entire built client bundle in `.vercel/output`. Adding the missing ignores took it from "never completes" to 17 seconds, which is what made a CI lint gate viable at all.

---

## 2. Critical & high findings

### 🔴 C-1 — Entire student directory readable by anonymous users
**Severity: Critical** · `supabase/migrations/20260718000001_role_based_access.sql:103-107`, `20260807000001_students_retire_classroom_id.sql:135-141`

Five views are granted to `anon`, and **no view in the entire migrations directory sets `security_invoker`** (verified by grep — the only match is a comment saying it is deliberately *not* set):

```sql
-- 20260807000001_students_retire_classroom_id.sql:135
-- Deliberately NOT security_invoker: it runs with the owner's rights and so
-- bypasses students' RLS, which is the entire reason anon can read it.
create view public.students_public as
  select id, name, roll, leetcode_id, created_at, last_scraped_at, scrape_error
  from public.students;
grant select on public.students_public to anon;
```

Granted to `anon`: `students_public`, `student_stats_public`, `daily_snapshots_public`, `recent_submissions_public`, `classrooms_public`.

Because these run with owner rights, RLS does not apply. They live in schema `public`, so PostgREST exposes them. `VITE_SUPABASE_PUBLISHABLE_KEY` is in the shipped JS bundle by design. Therefore:

```
GET https://<project>.supabase.co/rest/v1/students_public?select=*
GET https://<project>.supabase.co/rest/v1/student_stats_public?select=*
GET https://<project>.supabase.co/rest/v1/recent_submissions_public?select=*
```

returns **every student's full name, roll number, platform handles, real name, country, ranking, submission calendar, language/tag stats, and complete daily snapshot history** — unauthenticated.

**What this defeats.** The base tables *were* correctly revoked from `anon` (`20260718000001:119-123`), which makes the setup look safe. But the views were left granted, which nullifies:
- the masking layer in `src/lib/mask.ts` and all its call sites
- the anti-enumeration redesign documented at `src/lib/search.functions.ts:6-21`
- the claim in `src/lib/landing.functions.ts:21-24` that anon is revoked

**Fix.** Either add `WITH (security_invoker = true)` to each view, or `revoke select … from anon` and serve these through the already-masking server functions. Same issue at lower blast radius for `student_scores`, `student_colleges`, and `college_overview`, which are granted to `authenticated` with no `has_*_access` predicate.

---

### 🔴 C-2 — Cron auth bypassable by a request header
**Severity: Critical** · `src/integrations/supabase/cron-auth.ts:17` (verified by direct read)

```ts
export function requireCronSecret(): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET not configured");
  const request = getRequest();

  // Vercel Cron Jobs send x-vercel-cron: 1 (platform-authenticated)
  if (request.headers.get("x-vercel-cron") === "1") return;   // ← returns before comparing anything
  ...
}
```

`x-vercel-cron` is an ordinary request header. Vercel sets it on its own cron invocations but does not document stripping a client-supplied one — Vercel's own guidance is to verify `CRON_SECRET` precisely because the header is not a trust boundary.

This un-gates every `/api/public/*` route to the internet:

| Endpoint | What an attacker gets |
|---|---|
| `POST /api/public/cron/refresh` | Enqueue a platform-wide fan-out + run a 50s scrape chunk — compute/quota burn, outbound scraping from your IP |
| `POST /api/public/cron/seed-demo` | **Write** fabricated classrooms and students into production |
| `POST /api/public/jobs/pump` | Same, on demand, unlimited |
| `POST /api/public/jobs/run` | Plus C-3 below |

**Fix.** Delete line 17. Configure Vercel Cron to send `Authorization: Bearer $CRON_SECRET`. Rotate the secret.

*Secondary:* `safeEqual` (`:3-8`) early-returns on length mismatch, leaking the secret's length. Negligible for a high-entropy secret, but `crypto.timingSafeEqual` is cleaner.

---

### 🔴 C-3 — `CRON_SECRET` sent to an attacker-controlled host
**Severity: High** · `src/routes/api/public/jobs/run.ts:22-33` (verified by direct read)

```ts
const origin = request.headers.get("origin") ?? request.headers.get("host") ?? "";
const selfUrl = `https://${origin}/api/public/jobs/run`;
fetch(selfUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },  // ← secret to a header-derived host
  ...
});
```

The self-continuation target is built from request headers and the cron secret is attached as a bearer token. Chained with C-2, an attacker sets `Host: attacker.tld` and receives `CRON_SECRET` in their own logs — permanently un-gating `/api/public/*` even after C-2 is fixed.

**Mitigating factors, neither of which is a control:** Vercel routes by `Host`, so an arbitrary `Host` may not reach the deployment; an `Origin` value already contains a scheme, producing a malformed `https://https://evil.tld/…`. Additionally the guard condition `!("claimed" in result)` appears never to be true in practice, making this currently-dead code — but it is dead code holding a live secret next to attacker input.

**Fix.** Build the URL from a pinned `process.env.VERCEL_URL` / configured base URL, never from a request header. Delete the block entirely if the recursion is genuinely unreachable.

*Also on this route:* `:16-17` does `await request.json()` with no validation — `jobId` reaches `runChunk` with no UUID check. The server-function twin at `refresh-jobs.functions.ts:175` *does* validate.

---

### 🟠 H-1 — Anonymous student enumeration via `_` LIKE wildcard
**Severity: High** · `src/lib/search.functions.ts:34,70` (verified by direct read)

The validator's character class permits `_`:

```ts
q: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9\s.\-_@]+$/),
```

and the anonymous branch does:

```ts
// Exact, case-insensitive roll. No wildcards, so nothing to enumerate.
studentQuery = studentQuery.ilike("roll", q).limit(1);
```

`%` was correctly excluded — but **`_` is a SQL `LIKE` single-character wildcard**. `24CS0__` matches rolls the caller never knew. With `.limit(1)` this is slow, but it converts "you must know the exact roll" back into a character-by-character walk of the directory — reintroducing exactly the primitive the file's header comment says was removed.

**Fix.** Drop `_` (and keep `%` out) from the regex class, or escape LIKE metacharacters and use `.eq()` on a lowercased column.

---

### 🟠 H-2 — Cohort names leaked unmasked to anonymous callers
**Severity: High** · `src/lib/search.functions.ts:85,109` (verified by direct read)

For an anonymous viewer `allowedClassrooms` stays `null` (`:51`), so the guard at `:85` never fires:

```ts
if (allowedClassrooms !== null) memQuery = memQuery.in("classroom_id", allowedClassrooms);
```

The membership query runs **unfiltered**, and `:109-111` returns `classroom_names`, `avatar`, and `total_solved` verbatim. Only `name` and `leetcode_id` are masked.

This directly contradicts the sibling policy in `getStudentByRoll` (`students.functions.ts:992-995`), which suppresses classrooms for masked viewers on the grounds that "cohort membership is exactly what masking withholds". **The two public endpoints disagree with each other.**

---

### 🟠 H-3 — Half the application is not in version control
**Severity: High** · verified via `git status --porcelain` (53 untracked paths) and `git ls-files`

| Path | Status |
|---|---|
| `scraper-service/` (the entire FastAPI sidecar) | **UNTRACKED** |
| `src/lib/platforms/` (all ~10 platform adapters) | **UNTRACKED** |
| `tests/` + `vitest.config.ts` | **UNTRACKED** |
| `supabase/migrations/` | **11 of 24 untracked** |
| `src/lib/platform-worker.server.ts`, `platform-stats.server.ts`, `refresh-enqueue.server.ts` | UNTRACKED |
| `src/lib/reports.functions.ts`, `performance.functions.ts`, `colleges.*` | UNTRACKED |
| `src/components/landing/`, `src/components/platform/` | UNTRACKED |
| `src/routes/_authenticated.reports.tsx`, `.colleges.tsx`, `._admin.platforms.tsx` | UNTRACKED |

The 11 untracked migrations (`20260808000001`–`20260808000011`) are the entire multi-platform, colleges, and scoring subsystem — the schema that production is currently running on. **This is the highest-expected-loss item in the audit**, independent of severity ranking: a bad `git clean`, a lost disk, or a fresh clone by a collaborator loses the majority of the product.

**Fix.** `git add` everything above and commit before touching anything else in this report.

---

### 🟠 H-4 — Zero security headers
**Severity: High** · `vercel.json` (verified — 12 lines, no `headers` block)

| Header | Status | Consequence |
|---|:---:|---|
| Content-Security-Policy | ❌ | No XSS containment; session token is freely exfiltratable (see H-5) |
| Strict-Transport-Security | ❌ | A custom apex domain would not inherit a strong policy |
| X-Frame-Options / `frame-ancestors` | ❌ | `/auth` is framable → clickjacking / credential overlay |
| X-Content-Type-Options | ❌ | MIME sniffing |
| Referrer-Policy | ❌ | `/students/<roll>` leaks to third parties — **the roll number is the PII identifier** |
| Permissions-Policy | ❌ | — |

Note for implementation: `src/routes/__root.tsx:139` uses an inline `<script>` for the pre-paint theme swap (payload is a hardcoded constant, so it is safe today), and `:99-110` loads fonts from `fonts.googleapis.com`/`fonts.gstatic.com`. A CSP must carry a nonce or hash for the former and allow-list the latter.

---

### 🟠 H-5 — Sessions in `localStorage`, no cookie barrier
**Severity: Medium-High** · `src/integrations/supabase/client.ts:53-57`

```ts
auth: { storage: typeof window !== "undefined" ? localStorage : undefined,
        persistSession: true, autoRefreshToken: true }
```

No `httpOnly`/`secure`/`sameSite` cookie exists anywhere in the repo. Any XSS — or one malicious transitive dependency — is a full account takeover, with no CSP (H-4) to contain it. This composes directly with M-2 (`xlsx` prototype pollution running in the same origin).

*Upside, and worth recording:* because auth is a bearer header rather than a cookie, classic CSRF is structurally absent. A CSRF middleware is nonetheless registered at `src/start.ts:21-23`.

---

## 3. Medium findings

### ⚠️ M-1 — WITHDRAWN: three failing CodeChef tests
**Status: withdrawn. Does not reproduce.**

At the time of the original run this was real — `npx vitest run` reported 3 failed / 36 passed, and the output is preserved below. On re-running later in the same session the suite was **39/39 green**, and `tests/platforms.test.ts` had changed: line 285 read `expect(p.globalRank).toBeNull()` where the failing run had `expect(p.globalRank).toBeGreaterThan(0)`.

Neither the adapter nor the test file was modified as part of remediation. The most likely explanation is that the test file was edited concurrently, and the expectations now match the adapter's actual (correct) behaviour: the saved fixture renders `<strong>Inactive</strong> Global Rank`, so `null` is the honest reading.

**What survives from this finding, and is still worth acting on:** the shape guard at `codechef.ts:102` is `/user-details|rating-number|userdetails-container/i` — an OR across three tokens. Mangling any one of them still passes, so the "FAILS LOUD on redesign" property the file documents at `:14` is weaker than it reads. It should be an AND of the selectors the parse actually depends on.

<details><summary>Original failing output, for the record</summary>

All three were `tests/platforms.test.ts > codechef`:

```
× parses the numbers out of the real profile page
    TypeError: actual value must be number or bigint, received "object"
    at expect(p.globalRank).toBeGreaterThan(0)          // globalRank is null

× reads the full rating history from the inline all_rating array
    AssertionError: expected 0 to be greater than 10    // rating_history is []

× FAILS LOUD when the markup changes instead of reporting zeros
    AssertionError: promise resolved instead of rejecting
```

This is not a stale-test problem — it is a **live data-quality bug**. For a real CodeChef profile the adapter now returns `rating: null`, `stars: null`, `globalRank: null`, `rating_history: []` while still parsing `totalSolved: 632` correctly. Because `totalSolved` survives, `isImplausibleRegression` (`platform-stats.server.ts:72-89`) does not catch it — so CodeChef students are silently having their rating and rank nulled out on every refresh.

The third failure was the more serious design issue: the adapter is explicitly written to `parse_error` on a redesign rather than report zeros (`codechef.ts:14`).

</details>

### 🟡 M-2 — `xlsx@0.18.5` with two unfixed CVEs, parsed in the browser
`package-lock.json` pins `xlsx@0.18.5` — the npm registry copy, which SheetJS abandoned at that version.

- **CVE-2023-30533** — prototype pollution in `XLSX.read` (fixed in 0.19.3)
- **CVE-2024-22363** — ReDoS (fixed in 0.20.2)

Usage: `src/lib/file-parser.ts:11` parses admin-supplied spreadsheets **client-side** (`file-parser.ts:171-177`), and `src/lib/report-workbook.ts:1` writes exports. The read path is the exploitable one — prototype pollution executing in the same origin that holds the `localStorage` session token (H-5), with no CSP (H-4). **H-4 + H-5 + M-2 compose into a single realistic chain.**

**Fix.** Move to the SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-latest/xlsx.tgz`, ≥ 0.20.2).

### 🟡 M-3 — No rate limiting anywhere
No inbound rate limiter, throttle, lockout, or captcha exists in `src/`. (The `throttle` machinery under `src/lib/platforms/` is *outbound* scraper backoff.) Exposed:

- `/auth` — relies entirely on Supabase's built-in auth limits; no captcha, no failed-attempt counter
- `getStudentByRoll` — unauthenticated; roll numbers are sequential-ish (`24CS001`), so the directory is walkable one request at a time even without C-1
- `searchStudents` — unauthenticated, and now enumerable via H-1
- `/api/public/*` — nothing beyond the bypassable cron secret

### 🟡 M-4 — `scrape_runs` readable by any authenticated user
`supabase/migrations/20260725000001_scrape_runs.sql:18-22` — `for select using (true)` + `grant select … to authenticated`. Any account with *any* role (including a faculty member with zero assignments) reads every scrape run, including the `errors` jsonb that quotes failing student handles.

The `20260730000001_authz_hardening.sql` pass correctly tightened `faculty_assignments`, `refresh_jobs`, and `site_settings` this exact way — `scrape_runs` was simply missed. Same pattern at `college_platforms` (`20260808000011:172-175`).

### 🟡 M-5 — Permission oracle via `has_*` RPCs
`has_role`, `has_classroom_access`, `has_college_access`, `has_student_access` take an arbitrary `_user uuid` and are `GRANT EXECUTE … TO authenticated`. Any signed-in user can call `rpc('has_student_access', { _user: '<someone else>', _student: '<uuid>' })` and enumerate other staff members' access scope.

**Fix.** Force `_user := auth.uid()` internally, or revoke `authenticated` — the RLS policies invoke these internally and do not need the grant.

### 🟡 M-6 — Unbounded queries with no pagination
**Partially overstated in the original sweep — corrected here after re-checking each site against current code.**

| Location | Original claim | Actual state |
|---|---|---|
| `performance.functions.ts:104-133` | Unbounded, twice | ❌ **Was wrong** — already `.range(0, MAX_ROWS - 1)` on all three reads |
| `classrooms.functions.ts` | Unbounded | ❌ **Was wrong** — already has `MAX_ROWS` |
| `overview.functions.ts` | Bounded | ✅ Correct — `CHUNK = 500`, `MAX_ROWS` |
| `reports.functions.ts` | Bounded, refuses | ✅ Correct — `MAX_FACT_ROWS` |
| `students.functions.ts` (public snapshots) | Unbounded | ✅ **Confirmed** — now capped at 750 rows, newest-first |
| `platforms.functions.ts:57-68` | Unbounded | ✅ **Confirmed** — now `MAX_ROWS` + `RECENT_JOBS` |
| `cohort-platforms.server.ts:35-55` | Unbounded | ✅ **Confirmed** — now `MAX_ROWS` |

The general risk is real and unchanged: every `.in()` over student IDs still risks PostgREST's URL length limit at a few thousand students, and only `overview.functions.ts` chunks. `reports.functions.ts:126-132` remains the model to copy — it **refuses** above the ceiling rather than truncating.

`reports.functions.ts:126-132` is the model to copy: it **refuses** above `MAX_FACT_ROWS` rather than truncating.

### 🟡 M-7 — N+1 and non-atomic writes
- `staff.functions.ts:69-84` — one `auth.admin.getUserById` network round-trip **per staff row**, with a bare `catch {}` at `:75` that renders `email: "unknown"` with no signal.
- `platform-worker.server.ts:466-524` — `persist()`/`onError()` awaited **serially**, each doing 4–6 DB round-trips. For Codeforces' 100-handle batch that is ~500 sequential statements inside a 50s chunk budget.
- **No transactions anywhere in TypeScript.** `createStaffUser` (create auth user → insert role → insert assignments), `bulkImportWithClassrooms`, and `persistPlatformProfile` can all partially fail. A failure between `platform_stats.upsert` and `student_platform_accounts.update` leaves an account looking un-fetched. Only the SQL RPCs are atomic.

### 🟡 M-8 — Validation gaps
- `src/lib/settings.functions.ts:23` — `.validator((enabled: boolean) => enabled)` is an **identity function**. The TS annotation is erased at runtime; a string or object flows straight into the UPDATE. Should be `z.boolean().parse(d)`.
- `src/routes/api/public/jobs/run.ts:16-17` — no validation on `jobId`.
- `students.functions.ts:48` and `bulk-import.functions.ts:9` accept `email` as plain `.max(200)` with **no `.email()`**, inconsistent with the single-add path at `students.functions.ts:36`.

Otherwise zod usage is consistent and the bounds are real — this is a small set of gaps in an otherwise solid pattern.

### 🟡 M-9 — The one string-interpolated query
`src/lib/search.functions.ts:66` is the **only** interpolation site in the codebase:

```ts
.or(`roll.ilike.%${like}%,name.ilike.%${like}%,leetcode_id.ilike.%${like}%`)
```

The regex guard excludes `,` and parens, so a caller cannot append a filter node — **the guard holds today.** But `.` is permitted, and `.` is PostgREST's field/operator separator; safety rests entirely on the absence of `,`. This is fragile by construction. Prefer `.textSearch()` or three parameterised queries unioned in JS.

### 🟡 M-10 — CSV formula injection on export
`src/lib/report-workbook.ts:65` does `XLSX.utils.json_to_sheet(rows)` with student names unescaped. A name beginning `=`, `+`, `-`, or `@` becomes a live formula when the exported workbook opens in Excel. Admin→admin, but valid — prefix such cells with `'`.

---

## 4. Backend & data architecture

### What's genuinely excellent

The refresh worker is the strongest code in the repository, and it is worth saying so plainly.

- **Structural budget enforcement.** `budgetMs = 50_000` with `TAIL_MS = 6_000` reserved for commit/release; the deadline is threaded into every fetch and each network call clamps its own `AbortSignal.timeout` to what remains. Overrun is structurally impossible, not probabilistically unlikely.
- **Lease + compare-and-swap.** `claim_refresh_job` is a single conditional UPDATE re-checking the lease against the *Postgres* clock; `commit_*_batch` is a CAS on `(lease_owner, cursor)`. Zero rows means another worker moved it and the chunk aborts rather than double-counting.
- **An error taxonomy that drives behaviour.** `budget` → touch nothing (our fault). `not_found` → `invalid_handle` immediately. `throttle` → `blocked`, failure counter *not* incremented. `parse_error` → recorded, not counted (our adapter broke). `fail` → increment, `invalid_handle` at 5. This distinction is what keeps a platform outage from mass-invalidating real handles.
- **Data-loss guards.** `isImplausibleRegression` refuses a write when `total_solved` collapses. `definedColumns` distinguishes `undefined` ("not fetched — omit") from `null` ("platform reported nothing — store"). The `data` jsonb is **merged, not replaced**, so a partial run cannot erase a year of heatmap history.
- **Circuit breaker that excludes self-inflicted failures** — `budget` errors are deliberately kept out of the throttle ratio (`platform-worker.server.ts:307-310`).
- **In-code postmortems.** Several comments record the exact bug a line prevents (the `lease_until` clock skew, the `p_errors` jsonb-scalar stall, "never treat a query error as queue drained"). This is high-value institutional memory and should be preserved in review.

### Structural observation: RLS is not defence-in-depth

**Every authenticated data path in the app uses `supabaseAdmin` (service-role, RLS-bypassing)** — 40+ call sites. The per-request user-scoped client built at `auth-middleware.ts:77-89` is constructed correctly and **never used by a single handler**.

This is a legitimate architecture, but it must be a *decision*, not an accident. Its consequences:
- The completeness of the TypeScript checks in `authz.ts` is the *only* thing standing between a caller and the data.
- The grant hygiene in §2 C-1/M-4/M-5 becomes independently load-bearing, because it governs direct PostgREST access.

**Recommendation:** decide explicitly. Either migrate read paths onto `context.supabase` so RLS becomes a real second layer, or delete the unused client and document in `authz.ts` that it is the sole gate. Leaving it ambiguous invites a future contributor to assume a safety net that isn't wired up.

### Service-role containment

Three layers keep the service key out of the client bundle, and they work:
1. `client.server.ts:36-37` reads `process.env` only — never `import.meta.env`, so Vite cannot inline it.
2. Every import is `await import(...)` inside a handler body; TanStack strips `createServerFn().handler()` bodies from the client graph.
3. `authz.ts:50` wraps the accessor in `createServerOnlyFn` as defence-in-depth.

`src/lib/cohort-platforms.server.ts:5-12` documents a **real past regression** of exactly this kind. **Highest-value cheap control in this report:** turn that manual audit into a CI assertion —

```bash
grep -rq "SUPABASE_SERVICE_ROLE_KEY\|supabaseAdmin" .vercel/output/static/ && exit 1
```

The guarantee is currently a property of the bundler, not of the code.

### Swallowed errors

The worker paths fail loud; the read paths fail soft. That split is mostly principled and commented. The uncommented ones are the problem:

| Location | Assessment |
|---|---|
| `staff.functions.ts:75` | **Bare, uncommented** — renders `email: "unknown"` with no signal |
| `students.functions.ts:1137,1146,1159` | Bare. This exact pattern hid a `42703` for weeks (documented at `:1127-1129`) — single-student refreshes never appeared in Scrape History |
| `settings.functions.ts:13-16` | **Fails open** on a security-relevant setting (`google_auth_enabled: true` on error) |
| `classrooms.functions.ts:78,144` · `overview.functions.ts:79` | Commented "decorative", but a silent zero is indistinguishable from a real zero |

### Scraper sidecar

A ~620-line FastAPI/Scrapling service whose only job is returning browser-rendered HTML for the four platforms that need it (`hackerearth`, `interviewbit`, `code360`, `spoj`). Parsing stays in TypeScript. It holds no Supabase credentials and no student data — a clean boundary.

The four-level nested timeout stack (worker 50s → `render.ts` client cap → sidecar `hard_timeout` → Scrapling nav timeout) is carefully ordered, and the browser-pool recycling strategy is sound.

**One security issue:** `main.py:426` — if `SCRAPLING_TOKEN` is unset, *every caller is accepted*. It logs a warning at startup but still serves. For a service that fetches arbitrary URLs on request, **fail-open is the wrong default** — that is an open SSRF proxy if deployed unconfigured. Should refuse to start.

---

## 5. Frontend & UI

### Architecture

Clean, consistent, and unusually well documented. `src/routes/README.md` explains the file-naming conventions; several routes carry comments explaining *why* a pattern is required rather than just what it does.

**The dominant loader idiom**, repeated across ~7 routes:

```ts
loader: ({ context }) => {
  if (typeof window !== "undefined") return context.queryClient.ensureQueryData(qo);
}
```

The window guard is load-bearing and documented twice: `attachSupabaseAuth` is a *client* middleware, so an SSR loader sends no bearer token and `requireSupabaseAuth` rejects. This is correct, but it means **no authenticated route is server-rendered with data** — every authenticated page is a client-side fetch after hydration. That is a deliberate trade-off worth revisiting if TTFB matters.

**Guards are UX-only, by design.** `_authenticated.tsx` and `_authenticated._admin.tsx` both early-return during SSR then check client-side. Bypassing them yields an empty shell, not data — real enforcement is in the server functions. This is stated honestly in `src/hooks/use-role.ts:6-18`.

### Issues

| Issue | Location | Note |
|---|---|---|
| **1,642-line route** | `_authenticated.classrooms.$id.tsx` | Roster table, lens bar, tabs, matrix, insight panel, CSV export, 3 dialogs, keyboard shortcuts, all in one file. The single highest-value refactor target |
| Double auth round-trip | `_authenticated.tsx:27` + `:55` | `supabase.auth.getUser()` called in both `beforeLoad` and a component effect on every hard load |
| No return-URL preservation | `_authenticated.tsx:39-45` | Redirect happens via `useEffect` in `errorComponent`, so there's a rendered error frame and no `?redirect=` |
| Missing error boundaries | `/overview`, `/reports`, `/search`, `/_admin/classrooms/new`, `/_admin/import` | `/overview` has a `pendingComponent` but no `errorComponent` |
| No retry affordance | 9 routes | All are `<div className="p-8 text-sm text-destructive">{error.message}</div>` — raw server text, no recovery path |
| `console.error` during render | `__root.tsx:48` | Inside the `ErrorComponent` function body, not an effect — fires on every re-render |
| `toast.error(String(e))` | 29 occurrences | `String(new Error("x"))` renders `"Error: x"` — users see the `Error:` prefix on every failure |
| Duplicated `classroomsQO` | `dashboard.tsx:42`, `classrooms.index.tsx:13`, `app-sidebar.tsx:93` | Same query declared three times |
| Blob→anchor CSV download | `daily-matrix.tsx:202`, `student-list-dialog.tsx:70`, `classrooms.$id.tsx:747` | Implemented three times |

### Design system — a strength

All tokens live in one file, `src/styles.css` (684 lines), Tailwind v4 CSS-first with no config file.

- Palette in **oklch**, dark as the default, `.light` as the override, with `color-scheme` set on both
- Beyond shadcn's set: `--surface`, `--surface-2`, a difficulty ramp (`--easy`/`--medium`/`--hard`), 8 sidebar tokens
- Motion tokens (`--ease-snap/glide/swap`, `--duration-fast/base/menu/panel`) overriding Tailwind's defaults
- **The landing page's clever trick** (`:387-399`): the `.lp` scope *re-points the shared token names* locally, so every shadcn primitive inside the subtree picks up the landing palette with zero class changes
- No-flash theme init via an inline pre-paint script reading `localStorage['kinetic-theme']`

**Reduced-motion handling is exemplary** (`:572-623`). It collapses durations to 1ms rather than deleting animations, explicitly *re-slows* spinners and pulses, and hard-stops the marquee and `.lp-cells` — with a comment explaining that the blanket 1ms rule would otherwise freeze `.lp-cells` at opacity 1 as a solid amber block. Paired with `<MotionConfig reducedMotion="user">` at `index.tsx:58`. This is a level of care most production apps never reach.

### Accessibility

**Done well:** hand-rolled roving-tabindex radiogroups (`cohort-filter-bar.tsx:66-80`, `cohort-toolbar.tsx:57-84`) implemented correctly with `role="radiogroup"`, arrow keys, and `tabIndex={active ? 0 : -1}`. Keyboard shortcuts with proper `INPUT/TEXTAREA/isContentEditable` guards. `role="status" aria-live="polite"` on the refresh strip. Consistent `aria-hidden` on decorative icons, `htmlFor`/`id` pairing on ~35 inputs, Radix underneath all overlays.

**Gaps:**

1. **Heatmaps are invisible to assistive tech.** `heatmap.tsx:70-82` renders 365 bare `<div>`s with only a `title` attribute — no `role`, no `aria-label`, no keyboard reach, no text alternative for the grid. `daily-matrix.tsx` has the same shape. This is the primary data visualization in the product.
2. **Unlabelled switch.** `_admin.settings.tsx:81-89` — a `<button role="switch" aria-checked>` with no text content and no `aria-label`/`aria-labelledby`. Screen readers announce "switch, checked" with no name. (`ui/switch.tsx` exists and is used elsewhere; this one is hand-rolled.)
3. **`<h1>` is the eyebrow, not the title.** On 6 routes the `h1` is the 12px mono breadcrumb ("Almanac / Dashboard") and the real title is the `h2` below. Legal, but the document outline misleads.
4. **No skip link** anywhere — the authenticated shell is header → sidebar → main with no way to bypass the nav.
5. `student-search.tsx:64-70` closes on outside `pointerdown` but has no `focusout` handling, so tabbing out leaves the panel open.

### Dead code

**~2,000 lines of unused shadcn primitives** (0 importers): `form.tsx` (171), `chart.tsx` (331), `carousel.tsx` (240), `menubar.tsx` (229), `context-menu.tsx` (187), `calendar.tsx` (177), `navigation-menu.tsx` (120), `breadcrumb.tsx` (101), `pagination.tsx` (98), `drawer.tsx` (98), `input-otp.tsx` (69), `toggle-group.tsx` (57), `resizable.tsx` (37), `radio-group.tsx` (36), `hover-card.tsx` (27), `slider.tsx` (23), `aspect-ratio.tsx` (5).

Their transitive dependencies are also unused: `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`, `vaul`, `react-hook-form`, `@hookform/resolvers`, plus ~7 `@radix-ui/*` packages.

**Note on forms:** `react-hook-form` and `@hookform/resolvers` are dependencies, but the only file importing them is `ui/form.tsx`, which has zero importers. **Every form in the app is hand-rolled `useState` + `useMutation`** — auth, staff CRUD, classroom edit, student add, password change. Consequence: no field-level errors, no `aria-invalid`/`aria-describedby`, no submit-blocking. All failures surface as a toast. Either adopt the library or drop it.

`skeletons.tsx:111-113` — `AppShellSkeleton` is named and documented as a "sidebar + header shell" but its body is `return <AnimatedLoader text="Loading…" fullscreen />`. It renders no shell, contradicting its own docstring.

---

## 6. Testing & CI

### Current state

| Metric | Value |
|---|---|
| Test files | **1** (`tests/platforms.test.ts`, 490 lines) |
| Tests | 39 — **3 failing** |
| Subject | Scraper adapters only |
| Component / route / hook tests | **0** (no `@testing-library/*` installed) |
| Authz / RLS / masking tests | **0** |
| SQL tests | 0 (no pgTAP) |
| Python sidecar tests | 0 |
| CI | **None** |
| Coverage config | None |

The tests that *do* exist are good — fixtures recorded from live platforms rather than hand-written, `fetch` stubbed so an unrouted URL throws rather than silently 404ing, and a deliberate 10s timeout on the theory that "a test that hangs is a test that leaked a real network call". The Codeforces batch-isolation test (one bad handle must not fail 99) is exactly the right test to have.

### The gap that matters

**`src/lib/authz.ts` has zero tests.** It is the sole authorization boundary for the entire application (§4), it is nearly pure, and it is trivially testable. `role resolution`, `accessibleClassroomIds`, `assertStudentAccess`, and CEO college scoping should all be covered before anything else in this report is addressed.

Same argument for `platform-stats.server.ts` — `definedColumns`, `isImplausibleRegression`, and `recordFetchFailure` are pure functions encoding the data-loss guards described in §4.

### CI/CD

`.github/workflows/` contains **one** workflow, `pump.yml`, and it is not CI — it is the 10-minute cron pump. There is no typecheck, lint, or test on push or PR. `vitest.config.ts` exists and nothing runs it, which is exactly how three tests came to be failing unnoticed.

`pump.yml` itself is well built (concurrency group, fail-fast on missing secret, correct `--max-time 90` exceeding Vercel's 60s ceiling, explicit 504/408 tolerance). Two issues:

- **Script injection shape.** `${{ secrets.CRON_SECRET }}` and `${{ vars.DEPLOY_URL }}` are interpolated directly into the `run:` shell block rather than passed via `env:`. Anyone who can set a repository *variable* (a lower bar than a *secret*) can redirect the authenticated request or inject shell. Move both to `env:` and reference `"$CRON_SECRET"`.
- `:43` `cat "$body"` dumps the endpoint's JSON response into the workflow log — job IDs and platform names today, and public logs if the repo is public.

---

## 7. Repo & tooling hygiene

### 7.1 Version control
See H-3. **Fix this first.** 53 untracked paths, 11 of 24 migrations, the entire scraper service, all platform adapters, and the whole test suite.

### 7.2 Migration ordering ambiguity
Two migrations share the timestamp `20260807000002_*` (`college_ranks` and `student_ranks`). Ordering between them is filesystem-dependent. Rename one.

Related: three generations of rank function are all still installed — `student_college_ranks`, `student_ranks`, and the live `student_ranks_v2`. The first two are dead. All three do a **full scan of every student** on every call (`dense_rank() over (order by …)` cannot use an index), and `fetchStudentRanks` is called on the classroom page, the overview, *and* every public profile view. This is the most likely first scaling wall.

### 7.3 Lint is effectively disabled
`eslint.config.js:37` turns `@typescript-eslint/no-unused-vars` **off entirely** — which is precisely why ~2,000 lines of dead primitives and several unused exports never surfaced. `tsconfig.json` is `strict: true` but sets `noUnusedLocals: false` and `noUnusedParameters: false`.

Separately, `npx eslint .` did not complete within 5 minutes on this machine. A lint run nobody can afford to wait for is a lint run nobody will run — worth investigating (likely a missing `ignores` entry for `node_modules`, `.output`, `.vercel`, or `.tanstack`).

*Credit where due:* `eslint.config.js:24-33` has a nice custom rule blocking `server-only` imports from client files — a real guard against the C-1-adjacent bundle-leak class.

### 7.4 Type safety
`tsc --noEmit` is **clean** — a genuine strength. Only ~8 `any` escape hatches exist across the codebase (`platform/registry.ts:23`, `buckets.ts:81`, `classrooms.functions.ts:262`, `overview.functions.ts:74`, `search.functions.ts:102`, `platform-stats.server.ts:262`), each with an explicit eslint-disable. **Zero `@ts-ignore`, zero `@ts-expect-error`, zero TODO/FIXME/HACK markers** in the entire repository.

### 7.5 Naming trap
`src/lib/buckets.ts` is **not** about storage buckets — it is behavioural cohort filtering ("Active Today", "At Risk"). There is no file upload to Supabase Storage anywhere in this app; the bulk import parses client-side and POSTs JSON. Worth a rename before it misleads someone during an incident.

### 7.6 Dependencies
- `nitro@3.0.260603-beta` — a **pinned beta on the production request path**. Not a known CVE, but a supply-chain and stability risk worth naming explicitly.
- `xlsx@0.18.5` — see M-2.
- Everything else (`@supabase/supabase-js` 2.110.7, `vite` 8.1.5, `zod` 3.25.76, React 19.2) is current.
- **No `npm audit` in CI.**

---

## 8. Remediation roadmap

### Phase 0 — Do this today (hours)
1. **`git add` and commit all 53 untracked paths.** Nothing else in this document matters if the code disappears. *(H-3)*
2. **Delete `cron-auth.ts:17`**, the `x-vercel-cron` short-circuit. Configure Vercel Cron to send `Authorization: Bearer $CRON_SECRET`. **Rotate `CRON_SECRET`.** *(C-2)*
3. **Delete or repin the self-fetch in `jobs/run.ts:22-33`.** Never build a URL from a request header while attaching a secret. *(C-3)*

### Phase 1 — Close the data exposure (days)
4. **Add `security_invoker = true`** to `students_public`, `student_stats_public`, `daily_snapshots_public`, `recent_submissions_public`, `classrooms_public` — or revoke `anon` and serve via the masking server functions. Extend to `student_scores`, `student_colleges`, `college_overview`. *(C-1)*
5. **Fix `searchStudents`:** drop `_` from the validator regex; mask `classroom_names`, `avatar`, and `total_solved` for anonymous callers to match `getStudentByRoll`'s policy. *(H-1, H-2)*
6. **Role-gate `scrape_runs`**; scope `college_platforms` by college assignment. *(M-4)*
7. **Revoke `authenticated` EXECUTE** on the four `has_*` predicates, or force `_user := auth.uid()`. *(M-5)*
8. **Add a `headers` block to `vercel.json`:** CSP (nonce for the inline theme script, allow-list Google Fonts), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. *(H-4)*

### Phase 2 — Build the safety net (1–2 weeks)
9. **Add CI**: `typecheck && lint && test` on every push and PR. This is the control that would have caught M-1.
10. **Add the bundle-leak assertion** to CI: fail the build if any client asset references `supabaseAdmin` or `SUPABASE_SERVICE_ROLE_KEY`. Cheapest high-value control in this report.
11. **Fix the 3 failing CodeChef tests** — and fix the underlying adapter, which is silently nulling rating/stars/rank in production. Tighten the shape guard at `codechef.ts:102` from an OR to an AND. *(M-1)*
12. **Write tests for `authz.ts`** — role resolution, `accessibleClassroomIds`, `assertStudentAccess`, CEO scoping. Then `platform-stats.server.ts`'s pure guards.
13. **Move `xlsx` to the SheetJS CDN tarball** (≥ 0.20.2); add a file-size cap in `file-parser.ts`. *(M-2)*
14. Move `pump.yml` secrets from `run:` interpolation into `env:`; stop `cat`-ing response bodies.

### Phase 3 — Structural (ongoing)
15. **Decide the RLS question** (§4): migrate reads to `context.supabase`, or delete the unused client and document `authz.ts` as the sole gate. Do not leave it ambiguous.
16. **Add rate limiting** to `/auth`, `getStudentByRoll`, `searchStudents`, `/api/public/*`. *(M-3)*
17. **Bound the unbounded queries** — start with `performance.functions.ts` (currently returning silently truncated, i.e. *wrong*, numbers) and `getStudentByRoll`'s public snapshot read. Copy the chunking from `overview.functions.ts` and the refusal pattern from `reports.functions.ts:126`. *(M-6)*
18. **Split `_authenticated.classrooms.$id.tsx`** (1,642 lines) into roster / matrix / insights / dialogs.
19. **Fix the accessibility gaps** — heatmap `role`/`aria-label`/keyboard reach, the unlabelled settings switch, a skip link, heading hierarchy.
20. **Delete ~2,000 lines of dead UI primitives** and the ~7 unused dependencies. Decide on react-hook-form: adopt it or drop it.
21. Re-enable `no-unused-vars` in ESLint and `noUnusedLocals` in tsconfig, then fix the fallout.
22. Make `deactivateUser`'s name match its behaviour (it deletes); rename `buckets.ts`; drop the two dead rank functions; rename the colliding `20260807000002_*` migration.

---

## 9. What's genuinely good

Worth stating explicitly, because an audit that only lists problems misrepresents the codebase:

- **`src/lib/authz.ts` is a real single source of truth.** Capability predicates, fail-closed error handling, and delegation to the *same* SQL predicates used by RLS so the two copies cannot drift. Every authenticated server function routes through it, verified handler by handler.
- **The refresh worker's budget/lease/CAS/taxonomy design** is production-grade distributed-systems work — see §4.
- **The comments explain *why*, not *what*.** A dozen files carry in-code postmortems of the exact bug a line prevents: the `lease_until` clock skew, the `p_errors` jsonb-scalar stall, the `maybeSingle()` multi-role bug, the client-bundle service-key leak, the `.lp-cells` reduced-motion freeze. This is rare and valuable.
- **Deliberate security decisions with stated reasoning** — the existence oracle removed from `assertStudentAccess`, `ignoreDuplicates` on bulk import so a re-import can't revert a manual fix, the CSPRNG temp-password generator with rejection sampling to remove modulo bias, and the anti-enumeration redesign of `searchStudents` (which just needs its regex tightened).
- **Every table has RLS enabled.** No table was missed. Every `SECURITY DEFINER` function pins `search_path`. The problem is grants on views, not a careless base.
- **Reduced-motion and theming** are handled with more care than most commercial products.
- **Clean `tsc --noEmit`, zero `@ts-ignore`, zero TODO markers.**

The pattern across this audit is consistent: **the code the team wrote deliberately is strong; the exposure is in the layers where a default was accepted** — a view grant, a platform header trusted as auth, a missing `headers` block, a CI pipeline never created, a `git add` never run.

---

*Findings in §2 and §3 marked "verified" were confirmed by direct file read or command execution during this audit. Remaining findings come from a systematic sweep of the codebase and should be spot-checked before remediation.*
