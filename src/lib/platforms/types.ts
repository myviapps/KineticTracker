// The contract every coding platform implements.
//
// Adapters are pure fetch-and-normalize: they take a handle, return a
// NormalizedProfile, and never touch the database. Persistence, failure
// counting and cursor bookkeeping all live in the worker, so an adapter can be
// tested against a saved fixture with no Supabase in the picture.

/**
 * Why an error happened. The worker treats each kind differently, and getting
 * this classification wrong is the difference between parking a valid handle
 * and hammering a dead one:
 *
 *   throttle    — the platform is rate-limiting US. Back off, feed the circuit
 *                 breaker, retry later. Not the student's fault.
 *   not_found   — the platform says no such user. Stop spending requests on it;
 *                 the handle needs a human to fix. Never retried.
 *   parse_error — we reached the page and could not understand it. The ADAPTER
 *                 is broken (a site redesign), not the handle. Must be loud and
 *                 must never be mistaken for "this student has zero solves".
 *   budget      — our own chunk deadline expired mid-flight. Carries no
 *                 information about the handle at all, so it must not increment
 *                 consecutive_failures or trip the circuit breaker.
 *   fail        — anything else.
 */
export type PlatformErrorKind = "throttle" | "not_found" | "parse_error" | "budget" | "fail";

export class PlatformError extends Error {
  readonly name = "PlatformError";
  constructor(
    readonly kind: PlatformErrorKind,
    readonly status: number,
    message: string,
    readonly platformId?: string,
    /**
     * Response body for a non-2xx, when there was one.
     *
     * Not decoration: Codeforces reports a bad handle as HTTP 400 whose body
     * names the offending handle, and the batch path needs that name to evict
     * one handle and retry the rest. Without it a single typo fails a hundred
     * students.
     */
    readonly body?: string,
  ) {
    super(message);
  }
}

/**
 * The canonical shape, mapped 1:1 onto platform_stats.
 *
 * Every field is optional because no platform provides all of them — Codeforces
 * has no institute rank, GeeksforGeeks has no rating, HackerRank has no
 * difficulty split. `undefined` means "this platform does not report it";
 * `null` means "it reports it and the value is empty". The worker only writes
 * columns that are not undefined, so an adapter can never blank a field it
 * simply doesn't know about.
 */
export type NormalizedProfile = {
  displayName?: string | null;
  avatar?: string | null;
  country?: string | null;

  totalSolved?: number | null;
  easySolved?: number | null;
  mediumSolved?: number | null;
  hardSolved?: number | null;
  /** Platforms with no difficulty split put their whole count here. */
  unratedSolved?: number | null;

  rating?: number | null;
  maxRating?: number | null;
  globalRank?: number | null;
  countryRank?: number | null;
  instituteRank?: number | null;
  platformScore?: number | null;
  stars?: number | null;
  streak?: number | null;
  contestsAttended?: number | null;

  /** Platform-specific extras → platform_stats.data (calendars, per-track scores, contest history). */
  data?: Record<string, unknown>;

  /**
   * True when the required data arrived but optional extras were skipped —
   * usually because the chunk ran out of budget. Persisted as
   * fetch_status='partial' so the health page can distinguish it from a failure.
   */
  partial?: boolean;

  /**
   * Opaque per-adapter incremental state → student_platform_accounts.sync_cursor.
   * Codeforces needs this: total_solved has to be derived from the full
   * submission history, so it records the newest submission it has seen and asks
   * only for what is above that next time.
   */
  syncCursor?: Record<string, unknown>;
};

export type VerifyResult = {
  ok: boolean;
  /** Shown back to staff so a mismatched person is caught by eye at entry time. */
  displayName?: string | null;
  reason?: string;
};

export type FetchContext = {
  /**
   * Epoch-ms ceiling for this work, or undefined for "unbounded" (interactive
   * single-student refresh). Every request clamps its own timeout to what is
   * left, which is what makes a chunk unable to overrun its budget.
   */
  deadline?: number;
  /** Previous syncCursor, for adapters that fetch incrementally. */
  syncCursor?: Record<string, unknown>;
  /**
   * Pacing between an adapter's own sequential requests, overriding its default.
   *
   * Belongs in config rather than in a constant: the right gap is a property of
   * the platform (Codeforces documents 1 req/2s) and is exactly the number that
   * has to be retuned when a site starts throttling — which is why
   * platforms.base_cooldown_ms exists. Tests pass 0 so a stubbed fetch does not
   * sleep for real.
   */
  callGapMs?: number;
};

/** One unit of a batch fetch: the handle plus whatever progress we already have. */
export type BatchItem = {
  handle: string;
  syncCursor?: Record<string, unknown>;
};

export type PlatformAdapter = {
  id: string;

  fetchProfile(handle: string, ctx?: FetchContext): Promise<NormalizedProfile>;

  /**
   * Cheapest possible existence check, for the staff handle editor. Falls back
   * to fetchProfile when an adapter has no lighter endpoint.
   */
  verifyHandle?(handle: string, ctx?: FetchContext): Promise<VerifyResult>;

  /**
   * Only for platforms whose API takes many handles at once — Codeforces'
   * user.info accepts ~100, which turns a whole college into a few requests.
   * Returns one entry per requested handle; a per-handle PlatformError means
   * that handle failed while the rest succeeded.
   *
   * Takes {handle, syncCursor} pairs rather than bare handles. Passing only
   * handles looks tidier and quietly breaks incremental sync: the adapter has
   * nothing to resume from, so every run re-walks the full history, runs out of
   * budget partway, and the same accounts never finish.
   */
  fetchBatch?(
    items: BatchItem[],
    ctx?: FetchContext,
  ): Promise<Map<string, NormalizedProfile | PlatformError>>;
};

/** Coerce whatever a platform hands back into a number, or null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
