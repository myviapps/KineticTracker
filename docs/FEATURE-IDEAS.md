# Almanac — Feature Opportunity Map (all nine platforms)

## Two corrections worth stating up front

Reading every adapter properly overturned two things I had assumed from the LeetCode-shaped
view:

1. **"Attempts-per-solve is a LeetCode/Codeforces thing" — wrong.** HackerEarth, the
   *thinnest* adapter in the set, already extracts `solutions_submitted` alongside
   `total_solved`. The ratio is directly computable. Code360 extracts `coding_submissions`
   and `mcq_submissions` the same way. Four platforms support the quality metric, not two.
2. **"Codeforces is the only exact-coverage platform" — wrong.** HackerRank's badges
   endpoint returns `solved` **and `total_challenges` per track**, so coverage per track is
   an exact ratio, not an estimate. It is a different taxonomy from Codeforces tags, and
   just as precise.

The general lesson: the thin platforms are thin in *identity* data and surprisingly rich in
*behavioral* data. Judging them by their profile pages undersells them.

---

## Signal inventory

**✓** available · **◐** partial/derived · **✗** never published · **⬛** fetched today, discarded

| Signal | LeetCode | Codeforces | HackerRank | GFG | CodeChef | AtCoder | Code360 | HackerEarth |
|---|---|---|---|---|---|---|---|---|
| Total solved | ✓ | ✓ | ◐ summed badges | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exact solved set | ✗ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Difficulty split | E/M/H | ◐ from rating | ✗ | **5 tiers** | ✗ | ✗ | **4 tiers** | ✗ |
| Topic / track coverage | ◐ counts | **✓ exact** | **✓ exact ratio** | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Submissions vs solved** | ⬛ | ✓ per-verdict | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Ladder rating | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ◐ contest |
| Rating history | ✗ | ✓ | ✗ | ◐ contests | ✓ | ✓ + `performance` | ✗ | ✗ |
| Practice vs contest | ✗ | ✗ | **✓ per track** | ◐ | ✗ | ✗ | ✗ | ✗ |
| Heatmap / time series | ✓ | ✗ | ✗ | ✓ + `line_chart` | ✗ | ✗ | ◐ counts | ✗ |
| Streak | ✓ | ✗ | ✗ | ✓ cur + longest | ✗ | ✗ | ✓ cur + longest | ✗ |
| Languages | ✓ | ⬛ per submission | ◐ language tracks | ✓ | ✗ | ✗ | ◐ default | ✗ |
| **Institution** | ✗ | ✓ `organization` | ✓ `school` | ✓ + **`institute_rank`** | ✓ | ✗ | ✓ + **grad year** | ✗ |
| **Account age** | ✗ | ✓ `registered_at` | ✓ `created_at` | ✓ `created_date` | ✗ | ✗ | ✗ | ✗ |

---

## Per-platform: what each one uniquely unlocks

### HackerRank — the most under-used platform in the set

Three verified endpoints, and the two beyond `/profile` are where the value is.

- **`/badges` returns `solved` *and* `total_challenges` per track.** That is an **exact
  coverage ratio per track** — "82% of Data Structures, 11% of SQL" — the same precision
  Codeforces gives, on a different taxonomy. No other platform except Codeforces can do this.
- **`/scores_elo` splits practice from contest, per track**, with rank and medals for each.
  This answers a question nothing else in the product can: *does this student know the
  material, or only perform it untimed?* A large practice-minus-contest gap is exam anxiety
  or time-management failure — a completely different intervention from "hasn't studied".
- **It is the only platform that reports SQL competence.** Campus placement heavily tests
  SQL, and every other platform in the set is blind to it. Same for its per-language tracks
  (Python, Java, C++), which makes it a second language-portfolio source.
- `school`, `level`, `created_at`, `followers_count` for identity and account age.

**Features:** per-track coverage matrix · practice-vs-contest gap flag · **SQL readiness
report** · language-track portfolio.

> Note the landmine already documented in the adapter: an untouched track reports
> `score: 0.0, rank: 1`, which nearly published a zero-solve student as world rank #1. Any
> new per-track feature must reuse the existing non-zero-score filter.

### HackerEarth — thin identity, real behavioral signal

The adapter's own comments say the seed note *understated* it. Four stat cards render:
Problems Solved, Points, Contest Ratings, **Solutions Submitted**.

- **`solutions_submitted ÷ total_solved` is attempts-per-solve, available today**, sitting in
  `data.solutions_submitted` and read by nothing. The thinnest platform supports the quality
  metric natively.
- `Points` → `platformScore`, `Contest Ratings` → `rating`.

**Features:** quality/efficiency lens · effort-vs-output (Points relative to solved).

**Caveat that must be respected:** every fetch costs a ~6s sidecar render
([hackerearth.ts](src/lib/platforms/hackerearth.ts) documents 6s as the shortest settle that
returned all four cards on 3/3 runs). This platform must never be put on a tight refresh
cadence, and `SCRAPLING_URL` has to be deployed first.

### GeeksforGeeks — the Indian-placement platform, and the best habit data

- **`institute_rank` is a real published rank within the college.** No other platform gives
  this. It makes "top 10 in your college" a fact rather than something Almanac computes.
- **`pod_solved_current_streak` + `pod_solved_longest_streak`** — Problem-of-the-Day streaks.
  This is a *habit* signal distinct from raw volume, and GFG's POD is a daily commitment
  device many Indian colleges already push.
- **`line_chart` + `heat_map`** — a time series the platform computes itself, independent of
  our snapshots.
- **`monthly_score` vs cumulative `score`** — recent effort against accumulated total,
  directly.
- **Five difficulty tiers** (School, Basic, Easy, Medium, Hard) — the finest-grained ladder
  of any platform. School and Basic are deliberately folded into `unrated` with
  `weight_easy: 0.5`, precisely so grinding School problems can't game the score.
- `languages`, `badges`, `contests`, `created_date`.

**Features:** POD streak leaderboard · institute-rank verification · monthly-momentum card ·
five-tier progression ladder.

### CodeChef — division as a milestone

- **`division` (Div 1–4) is a published skill tier**, and division *movement* is a
  promotion/demotion event. That is a cleaner, more legible milestone than a rating delta —
  "you moved to Div 2" means something to a student in a way "+47 rating" does not.
- Full `rating_history` inline as real JSON.
- `institution`, star rating derived from rating (correctly computed rather than scraped
  after a 7-star account parsed as 1).
- `contestsAttended` taken from the page text rather than history length, because the array
  counts rated contests only.

**Features:** division promotion tracking and alerts · star milestones · contest history.

### AtCoder — the cleanest trajectory signal anywhere

- **`rating_history` carries `performance` per contest**, not just rating. Performance
  consistently *below* rating means a student coasting on an old peak; consistently above
  means someone climbing fast. That is a direct read on trajectory requiring no inference —
  the single sharpest signal in the entire dataset.
- `colour` (AtCoder's well-known rating bands), `unrated_contests`.
- Solved counts come from the kenkoooo mirror, and the adapter records `solved_source` so
  provenance is visible.

**Features:** performance-vs-rating divergence flag · colour-band progression.

### Code360 — batch data and MCQ/aptitude

- **`graduation_year`, parsed out of the institution row.** I earlier proposed adding
  `batch_year` to `classrooms` for batch-over-batch benchmarking — Code360 supplies it for
  free, per student, and can seed or cross-check that field.
- **`mcq_submissions` separate from `coding_submissions`.** MCQ is aptitude-test-shaped, and
  service-company placement rounds are heavily aptitude-based. Nothing else in the set sees
  this dimension at all.
- **Four tiers** including "Ninja" above Hard, correctly routed to `unrated` rather than
  inflating `hardSolved`.
- `current` and `longest` streak, `institution`, `default_language`, `profile_views`.

**Features:** aptitude-vs-coding balance · graduation-year backfill · four-tier ladder.

### Codeforces — exactness

- **The complete solved set**, walked into a resumable `Set<ProblemKey>` in `sync_cursor`.
- **`tags?: string[]` is declared on the submission type at
  [codeforces.ts:130](src/lib/platforms/codeforces.ts#L130) and used nowhere**, and the
  problemset cache at [lines 73-79](src/lib/platforms/codeforces.ts#L73) keeps only `rating`
  while discarding the tags in the same response. Adding one field to that cached map gives
  exact topic mastery and exact unsolved-problem recommendations with **zero extra HTTP**.
- Per-submission verdicts (WA/TLE/RE) and `programmingLanguage`, both unread.
- `registered_at` → account age. `organization` → institution. Full `rating_history`.

### LeetCode — breadth, but soft on proof

Richest single profile (topics, languages, badges, heatmap, contests) but the **only**
platform that cannot reveal what was actually solved — capped at 20 recent submissions. Its
`submitStatsAll.totalSubmissionNum` is fetched per difficulty and collapsed into one
`acceptance_rate` at [leetcode.server.ts:358-363](src/lib/leetcode.server.ts#L358).

---

## Cross-cutting features these enable

### 1. Universal, on `daily_snapshots` — works on all nine
`daily_snapshots` is keyed `(student_id, platform_id, snapshot_date)`, so anything built
there lights up everywhere, **including HackerEarth and Code360**, which publish no calendar
of their own. Building these on LeetCode's `submission_calendar` instead would strand them
on one platform.

- **Consistency Index** — active days ÷ days enrolled, longest gap, weekly variance
- **Cram detection** — >60% of solves in <10% of active days
- **Most Improved** — delta-ranked, so the same ten names stop winning forever
- **Silence prediction** — flag before the 30-day `at_risk` autopsy
- **Platform migration** — flat on LeetCode but climbing on Codeforces is not disengagement

### 2. Account-age normalization — Codeforces, HackerRank, GFG
`registered_at` / `created_at` / `created_date` are all captured and unread. 200 solved in
six months is a completely different student from 200 solved in four years, and every
leaderboard in the product currently treats them as identical. **Solve rate per active month
is a fairer ranking than any total.**

### 3. Institution verification — five platforms report it, nothing reads it
CF `organization`, CC `institution`, GFG `institute_name`, HR `school`, Code360
`institution`. A handle whose profile names the student's own college is almost certainly
theirs — attacking the wrong-handle failure class that
[20260819000001](supabase/migrations/20260819000001_preserve_leetcode_handle_case.sql)
documents (ten students silently parked at `consecutive_failures = 5`) **without asking the
student to do anything**. GFG's `institute_rank` makes `instituteRank` trustworthy.

### 4. Quality lens — four platforms, one question
"Learning or grinding?", answered by whatever each platform publishes: Codeforces verdict
distribution and attempted-difficulty progression · LeetCode attempts-per-difficulty ·
HackerEarth `solutions_submitted ÷ solved` · Code360 coding vs MCQ submissions. This is
exactly the shape [platform-lens.ts](src/lib/platform-lens.ts) already models.

### 5. Coverage, at each platform's real precision
Codeforces **exact by topic** · HackerRank **exact by track** · GFG 5 tiers · Code360 4 tiers
· LeetCode estimated counts. A canonical topic taxonomy mapped per platform lets these
aggregate — the cross-platform coverage view no single-platform tracker can produce.

### 6. Unified contest layer — LeetCode, Codeforces, CodeChef, AtCoder, GFG
Full contest-by-contest histories already sit in `data.rating_history` and render as, at
most, a sparkline. Cohort participation reporting ("only 12 of 60 entered last weekend"),
a cross-platform calendar with nudges, division/colour/star milestones, and rating volatility.

### 7. Placement-readiness composite — needs the whole set
No single platform answers "is this student placement-ready". The combination does:
DSA depth (CF/LC) · **SQL (HackerRank only)** · **aptitude/MCQ (Code360 only)** ·
**consistency (GFG POD streaks)** · contest temperament (CC/AtCoder). **This is the strongest
argument for enabling all of them** — the composite is a genuinely new product, not nine
separate scoreboards.

### 8. Outcome tracking
Record offer / company / role / package. It converts the Almanac Score from assertion to
testable claim, and it is the **only** honest way to calibrate cross-platform weights — every
coefficient is already a tunable column on `platforms`, and "is 1900 Codeforces worth more
than 400 LeetCode solves?" cannot be answered by intuition.

---

## Revision Tracks — solving once is not learning

Every metric in Almanac counts a problem the moment it is solved and then assumes the
knowledge is permanent. It isn't. A student who solved 40 DP problems in March and hasn't
touched DP since is scored identically to one who solved them last week, and will do
markedly worse in an interview. **Nothing in the product currently models decay.**

Revision tracks close that, at three fidelities matching what each platform can prove.

### R1. Problem-level spaced repetition — Codeforces (exact), LeetCode (last 20)
Codeforces gives the exact solved set *with submission timestamps*; LeetCode gives the 20
most recent with `submitted_at` in `recent_submissions`. That is enough for an SM-2-style
schedule: resurface at ~7d, ~21d, ~60d, with the interval stretching on "still got it" and
collapsing on "had to look it up".

Storage is nearly free — `recommendation_feedback` from the recommendations design already
has the right grain `(student_id, slug)`. It needs three columns: `last_reviewed_at`,
`interval_days`, `ease`.

### R2. Topic-level decay — LeetCode, HackerRank, GFG, Code360, Codeforces
Where per-problem history doesn't exist, decay still works at topic grain: *"you last moved
the needle on Graphs six weeks ago."*

> **This needs a schema addition.** `tag_stats` (LeetCode) and per-track `solved`
> (HackerRank) live only in the **latest** row — `student_stats` and `platform_stats` are
> both current-state tables. `daily_snapshots` stores totals and the difficulty split, but
> not topic breakdown, so topic movement over time is not currently reconstructable. A
> `topic_snapshots(student_id, platform_id, topic, solved, snapshot_date)` table, written on
> the same cadence, is the prerequisite for every decay feature — and it is worth adding
> early, because history cannot be backfilled. **Every day it doesn't exist is a day of
> topic history permanently lost.**

### R3. Retention measurement — Codeforces only, and genuinely novel
Codeforces submissions carry verdicts and timestamps per problem, so a *re-attempt* is
visible. Re-solving cleanly on the first try months later is real evidence of retention;
needing four attempts is evidence it was never internalized. No competitor measures this,
and it is the only hard retention signal available anywhere in the set.

### R4. Faculty-assigned revision tracks
The mirror of the recommendation ladder: instead of problems the student *hasn't* solved,
a set they *have*, resurfaced before a placement drive. Reuses `problem_ladders` with a
`mode` of `learn` or `revise`.

### R5. Pre-drive cram plan
Two weeks before a specific company's drive, generate a revision plan from what the student
has already solved, weighted toward that company's archetype (§7 readiness composite). This
is the one place where cramming is legitimate — and it is far better served by revising
known material than by chasing new problems.

**Why this pairs with the student portal:** decay is invisible to staff and obvious to the
student the moment they open an old problem and blank on it. R1 and R3 need the student's own
"still got it / forgot it" input to work, which only exists once there is somewhere for them
to give it.

---

## Revised top five

| # | Feature | Why |
|---|---|---|
| 1 | **Enable the five pure-HTTP adapters** (CF, CC, AtCoder, GFG, HackerRank) | Config flips. Unlocks nearly everything below. HackerEarth/Code360 follow once `SCRAPLING_URL` is deployed. |
| 2 | **HackerRank per-track coverage + practice-vs-contest** | Exact ratios already returned by an endpoint we already call, plus the only SQL signal in the set. |
| 3 | **Codeforces problem tags** | Tags sit in a response already parsed. Exact topic mastery, zero extra requests. |
| 4 | **`topic_snapshots` table** | Small, boring, and **time-critical**: topic history cannot be backfilled, so every day it doesn't exist is a day permanently lost. Prerequisite for all decay and revision work. |
| 5 | **Universal Consistency Index + account-age normalization** | Built on `daily_snapshots` + three unread date columns; works on all nine and corrects a metric that rewards cramming. |

Close behind: **institution verification** (five platforms already report it into `data`;
near-zero cost, fixes a documented ops pain) and **outcome tracking**, which is the only
honest way to calibrate cross-platform weights once more than one platform is live.

SPOJ and InterviewBit stay off — both are `blocked` on measured evidence, not assumption.
