import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  getActiveRefreshJobs,
  getNextRefreshJobId,
  runRefreshJobChunk,
} from "@/lib/refresh-jobs.functions";
import type { Database } from "@/integrations/supabase/types";

export const REFRESH_JOB_KEY = ["refresh-job"] as const;

/**
 * Every cached query a completed scrape can invalidate.
 *
 * This is one list rather than an inline trio at each call site because the
 * inline version silently went stale as the app grew: only `classroom`,
 * `classrooms` and `overview` were ever invalidated, so after a refresh the
 * cohort tables updated while an OPEN STUDENT PROFILE kept rendering
 * pre-refresh numbers until a hard reload — the page looked wrong next to a
 * platform tab that had just refetched. The rankings page, daily matrix and
 * both performance panels had the same gap.
 *
 * These are PREFIX keys: TanStack matches by prefix, so ["student"] covers
 * ["student", roll] for every student, and ["matrix-breakdown"] covers every
 * classroom/platform/date-range permutation.
 *
 * Anything added here that reads scraped numbers should be added to this list;
 * a query that doesn't read them (settings, staff, search) must not be, or a
 * long refresh turns into a refetch storm.
 */
const SCRAPE_TOUCHED_KEYS: readonly (readonly string[])[] = [
  ["classroom"],
  ["classrooms"],
  ["overview"],
  ["student"],
  ["rankings"],
  ["matrix-breakdown"],
  ["cohort-performance"],
  ["performance-windows"],
  ["colleges"],
  // Both read scraped numbers and both were missing, so a refresh left the
  // reports scope picker and the platform health page quoting stale figures.
  ["report-scopes"],
  ["platform-health"],
];

export function invalidateScrapedData(qc: QueryClient) {
  for (const queryKey of SCRAPE_TOUCHED_KEYS) {
    qc.invalidateQueries({ queryKey, refetchType: "all" });
  }
}

type JobRow = Database["public"]["Tables"]["refresh_jobs"]["Row"];

/** A live job, with the platform it belongs to resolved for display. */
export type RefreshJobView = JobRow & {
  platform_id: string;
  platform_name: string;
  sort_order: number;
};

/** What getActiveRefreshJobs returns: the live jobs plus a change token. */
export type RefreshJobsResult = { jobs: RefreshJobView[]; pulse: string };

export type RefreshAggregate = {
  /** Non-terminal jobs, in platform sort order. */
  jobs: RefreshJobView[];
  active: boolean;
  /** Worst-of across jobs: running beats queued beats paused. */
  status: "idle" | "queued" | "running" | "paused";
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
  /** Earliest resume time among paused jobs, for the "resumes at" copy. */
  resumeAfter: string | null;
};

function aggregate(jobs: RefreshJobView[]): RefreshAggregate {
  if (jobs.length === 0) {
    return {
      jobs,
      active: false,
      status: "idle",
      processed: 0,
      total: 0,
      succeeded: 0,
      failed: 0,
      resumeAfter: null,
    };
  }

  const status = jobs.some((j) => j.status === "running")
    ? "running"
    : jobs.some((j) => j.status === "queued")
      ? "queued"
      : "paused";

  const resumes = jobs
    .filter((j) => j.status === "paused" && j.resume_after)
    .map((j) => j.resume_after as string)
    .sort();

  return {
    jobs,
    active: true,
    status,
    processed: jobs.reduce((a, j) => a + (j.processed ?? 0), 0),
    total: jobs.reduce((a, j) => a + (j.total ?? 0), 0),
    succeeded: jobs.reduce((a, j) => a + (j.succeeded ?? 0), 0),
    failed: jobs.reduce((a, j) => a + (j.failed ?? 0), 0),
    resumeAfter: resumes[0] ?? null,
  };
}

/**
 * Slowest cadence at which a moving pulse may refetch every scraped query.
 * Progress advances continuously during a run; the pages do not need to.
 */
const PULSE_THROTTLE_MS = 5000;

/*
  Module scope, not component refs, and deliberately so.

  useRefreshJobStatus is mounted several times over on a single page — the
  refresh button, the progress strip, the lens pills, the route itself, the
  pump. Per-instance refs would give each of them its own idea of "have I seen
  this pulse", so one change would fan out into five invalidateScrapedData calls
  in the same tick. One tab, one watermark, one refetch.

  Only ever touched inside effects, so it never runs during SSR, where module
  state would be shared across requests.
*/
const pulseWatch: {
  seen: string | undefined;
  lastAt: number;
  trailing: ReturnType<typeof setTimeout> | null;
} = { seen: undefined, lastAt: 0, trailing: null };

/**
 * Read-only view of the active refresh. Safe to call from any number of
 * components — they all share one query. Does NOT pump; see useRefreshJobPump.
 */
export function useRefreshJobStatus() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: REFRESH_JOB_KEY,
    queryFn: () => getActiveRefreshJobs(),
    // Poll fast while anything is running so progress feels live; slow when idle.
    //
    // The idle interval used to be 15s, which was the width of the window a
    // short refresh could hide in: a cohort of twenty students finishes inside
    // one tick, so a tab that was not the one that clicked the button saw an
    // empty list before and an empty list after. 8s halves that, and the pulse
    // below closes it properly.
    refetchInterval: (q) =>
      (q.state.data as RefreshJobsResult | undefined)?.jobs.length ? 2000 : 8_000,
    // Keep polling while the tab is backgrounded. A 1000-student refresh runs
    // for ~15 minutes and the user will switch away; with the default (false)
    // the pump's view of the job froze and it hammered a dead job forever.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const result = query.data as RefreshJobsResult | undefined;
  const jobs = useMemo(() => result?.jobs ?? [], [result]);
  const pulse = result?.pulse;
  const agg = useMemo(() => aggregate(jobs), [jobs]);

  /*
    THE propagation mechanism: refetch everything whenever the server says
    scraped data has moved.

    Level-triggered on purpose. The edge-triggered version below only fires for
    a tab that personally witnessed the job go active and then idle, which the
    tab that clicked the button always does and a passive tab often does not —
    it polls on an interval, and a short refresh lives and dies between two
    ticks. That is why an admin's "Refresh All" updated the admin's screen and
    nobody else's.

    Comparing a token instead means being asleep costs latency, not correctness.

    The first observed pulse is recorded WITHOUT invalidating: on a cold mount
    the data was just fetched, and refetching every query on arrival would make
    every navigation pay for a refresh that happened yesterday.
  */
  useEffect(() => {
    if (pulse === undefined) return;
    const seen = pulseWatch.seen;
    pulseWatch.seen = pulse;
    if (seen === undefined || seen === pulse) return;

    /*
      Throttled, with a guaranteed trailing run.

      The pulse also carries in-flight progress, and while a job is running this
      query polls every 2s — so an unthrottled version would refetch nine query
      prefixes every two seconds for the fifteen minutes a 1000-student refresh
      takes. The trailing timer is what makes throttling safe here: dropping the
      last change would leave the page one batch short of the truth forever,
      which is the failure this whole mechanism exists to prevent.
    */
    const since = Date.now() - pulseWatch.lastAt;
    if (since >= PULSE_THROTTLE_MS) {
      pulseWatch.lastAt = Date.now();
      invalidateScrapedData(qc);
      return;
    }
    if (pulseWatch.trailing) return; // already armed; it will pick up this change
    pulseWatch.trailing = setTimeout(() => {
      pulseWatch.trailing = null;
      pulseWatch.lastAt = Date.now();
      invalidateScrapedData(qc);
    }, PULSE_THROTTLE_MS - since);
    // No unmount cleanup: the timer is tab-wide, and another mounted consumer
    // (or the next mount) still needs the trailing refetch to land.
  }, [pulse, qc]);

  // Kept as a second path, cheap and independent: it covers the first tick
  // after a cold mount, where the pulse has nothing to compare against yet.
  const wasActive = useRef(false);
  useEffect(() => {
    if (agg.active) {
      wasActive.current = true;
    } else if (wasActive.current) {
      wasActive.current = false;
      invalidateScrapedData(qc);
    }
  }, [agg.active, qc]);

  /** Per-platform lookup for the lens pills. */
  const byPlatform = useMemo(() => {
    const m = new Map<string, RefreshJobView>();
    for (const j of jobs) m.set(j.platform_id, j);
    return m;
  }, [jobs]);

  return { ...query, byPlatform, ...agg };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns undefined if another tab already holds the pump lock. */
async function withPumpLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(
    "kinetic-refresh-pump",
    { mode: "exclusive", ifAvailable: true },
    async (lock) => (lock ? fn() : undefined),
  );
}

/**
 * Drives the refresh forward. MUST be mounted exactly once (in _authenticated.tsx).
 *
 * The loop asks the SERVER which job to advance on every round rather than
 * closing over one id. It used to be keyed on `jobId`, which was correct while a
 * refresh was a single global job — but the enqueue now fans out one job per
 * platform, and a loop bound to one id drives that one to completion while the
 * other four sit at 0/N. Delegating the choice to next_platform_job() also means
 * this pump and the cron pump apply the same fairness rule, so a busy platform
 * cannot starve the rest.
 *
 * Everything below the job selection is unchanged and deliberately so: the
 * lock, the idle cap and the read-through-a-ref pattern each fix a real bug.
 */
export function useRefreshJobPump() {
  const { jobs, active, resumeAfter } = useRefreshJobStatus();
  const qc = useQueryClient();
  const runChunk = useServerFn(runRefreshJobChunk);
  const nextJobId = useServerFn(getNextRefreshJobId);

  const jobsRef = useRef<RefreshJobView[]>([]);
  jobsRef.current = jobs;

  /*
    No progress-driven invalidation here any more.

    It used to watch summed `processed` and refetch on a 5s throttle — the same
    signal, the same throttle, but only in the ONE tab holding the pump. Every
    tab now gets it from the pulse in useRefreshJobStatus, which is strictly
    more coverage from strictly less code.
  */

  /*
    Keyed on "is anything live at all", not on a job id — a job finishing no
    longer tears the loop down, it just picks the next one.

    `resumeAfter` is in the deps for a subtler reason. A rate-limited job is
    parked with a resume_after 15 minutes out, and until that passes
    next_platform_job() correctly returns nothing. The loop would spend its idle
    budget in the first minute, give up, and never come back: `active` stays true
    the whole time (paused counts as live), so the effect never re-ran and the
    job sat paused forever. Re-arming when the pause window changes is what makes
    "resumes at 14:32" actually true rather than a label.
  */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    // Give up after this many consecutive rounds that move nothing. Without a
    // cap, a backgrounded tab (TanStack Query pauses polling when the window
    // loses focus, so the ref goes stale) retried a dead job every few seconds
    // forever. Sized to outlast one lease so a chunk finishing on another tab
    // is waited out rather than abandoned.
    const MAX_IDLE_ROUNDS = 15;
    const IDLE_BACKOFF_MS = 4000;
    /** Longest single sleep while parked. Keeps a stale tab from oversleeping. */
    const MAX_PARK_MS = 60_000;

    const nameFor = (id: string) =>
      jobsRef.current.find((j) => j.id === id)?.platform_name ?? "Refresh";

    void (async () => {
      let idleRounds = 0;

      while (!cancelled) {
        if (idleRounds >= MAX_IDLE_ROUNDS) return;

        let jobId: string | null;
        try {
          jobId = await nextJobId();
        } catch {
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }
        if (cancelled) return;

        /*
          Nothing eligible right now. Two very different reasons, and treating
          them the same is what left rate-limited jobs stuck.

          If every remaining job is PARKED with a future resume_after, this is
          not idleness — it is a scheduled wait, and the answer is known: sleep
          until the earliest one is due. Counting these toward the give-up cap
          burned all 15 rounds inside the first minute of a 15-minute pause, and
          because `active` never changed the effect never restarted. The job then
          waited for a pump that was never coming.

          Genuine idleness — no eligible job and nothing parked either — still
          counts toward the cap, which is what stops a backgrounded tab spinning.
        */
        if (!jobId) {
          const parkedUntil = jobsRef.current
            .filter((j) => j.status === "paused" && j.resume_after)
            .map((j) => Date.parse(j.resume_after as string))
            .filter((t) => Number.isFinite(t) && t > Date.now())
            .sort((a, b) => a - b)[0];

          if (parkedUntil) {
            // +1s so we wake just AFTER it becomes eligible, not on the boundary
            // where the database clock may still round the other way.
            const wait = Math.min(parkedUntil - Date.now() + 1_000, MAX_PARK_MS);
            await sleep(wait);
            continue;
          }

          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }

        const platform = nameFor(jobId);

        // Deliberately no client-side lease check here. lease_until is written
        // and compared by the Postgres clock, and the browser's clock can be
        // wildly out of step with it (a dev machine measured 33s ahead), so any
        // comparison done here is unreliable. claim_refresh_job is atomic and
        // cheap — just ask, and let the database be the judge.
        let res;
        try {
          res = await withPumpLock(() => runChunk({ data: { jobId } }));
        } catch {
          // Network/auth/timeout — back off, then the lease check retries.
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }

        if (cancelled) return;
        await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });

        // undefined => another tab is pumping. Let it.
        if (!res) {
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }

        const finished =
          res.done || (res.jobStatus !== undefined && !ACTIVE_STATUSES.has(res.jobStatus));

        if (finished) {
          if (res.done || res.jobStatus === "completed") {
            toast.success(`${platform} refreshed — ${res.succeeded} updated, ${res.failed} failed`);
            invalidateScrapedData(qc);
          }
          // Straight on to the next platform rather than returning — that is the
          // whole point of not being bound to one job id.
          idleRounds = 0;
          continue;
        }

        if (res.paused) {
          // Named, because "LeetCode is rate limiting" was hardcoded here and
          // became a lie the moment a second platform could pause.
          toast.warning(`${platform} is rate limiting — it will resume automatically.`);
          idleRounds = 0;
          continue;
        }

        if (!res.claimed || res.aborted) {
          idleRounds += 1;
          await sleep(IDLE_BACKOFF_MS);
          continue;
        }

        // Chunk hit its time budget with work left — go again now.
        idleRounds = 0;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, resumeAfter, runChunk, nextJobId, qc]);
}

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);

/** @deprecated use useRefreshJobStatus (read) or useRefreshJobPump (drive) */
export const useRefreshJob = useRefreshJobStatus;
