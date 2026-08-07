// Shared HTTP client for every platform adapter.
//
// Generalises the retry/backoff/classification logic that already lives inside
// gql() in leetcode.server.ts, and adds the two things the multi-platform worker
// needs: budget-aware aborts, and an error taxonomy rich enough that the worker
// can tell "this handle is wrong" from "this site is blocking us" from "our own
// parser is broken".

import { PlatformError, type FetchContext, type PlatformErrorKind } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Below this much remaining budget a request cannot meaningfully complete. */
const MIN_CALL_MS = 1_500;
const MAX_ATTEMPTS = 3;

/**
 * Browser-like by necessity, not by cunning. HackerRank, CodeChef and
 * GeeksforGeeks all sit behind Cloudflare and return a challenge page to
 * anything that looks like a bare script. This is the minimum that gets a normal
 * 200 back; it is not an attempt to defeat a bot check, and adapters treat a
 * challenge response as a throttle and back off rather than retrying harder.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export function remainingMs(deadline?: number): number {
  return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - Date.now();
}

export function hasBudget(deadline?: number, need = MIN_CALL_MS): boolean {
  return remainingMs(deadline) >= need;
}

/**
 * Optional egress rewrite, for when a datacenter IP gets blocked outright.
 *
 * Expressed as a URL TEMPLATE rather than an HTTP proxy dispatcher on purpose:
 * every commercial scraping proxy (ScraperAPI, ScrapingBee, ZenRows) works by
 * wrapping the target URL, and a template works identically under Node, Vercel's
 * runtime and a GitHub runner, whereas an undici dispatcher does not travel
 * cleanly across all three.
 *
 *   PLATFORM_PROXY_TEMPLATE="https://api.scraperapi.com/?api_key=KEY&url={url}"
 */
function applyProxy(url: string): string {
  const tpl = process.env.PLATFORM_PROXY_TEMPLATE;
  if (!tpl || !tpl.includes("{url}")) return url;
  return tpl.replace("{url}", encodeURIComponent(url));
}

/** Cloudflare / bot-wall interstitials return HTTP 200 with a challenge body. */
function looksLikeChallenge(body: string): boolean {
  if (body.length > 200_000) return false; // real pages are big; challenges are not
  return (
    /just a moment/i.test(body) ||
    /cf-browser-verification|challenge-platform|__cf_chl/i.test(body) ||
    /enable javascript and cookies to continue/i.test(body)
  );
}

export type RawResponse = {
  status: number;
  body: string;
  contentType: string;
};

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-request timeout, before budget clamping. */
  timeoutMs?: number;
  /** 404 is expected for a bad handle; adapters that use 404 for other things opt out. */
  treat404AsNotFound?: boolean;
  platformId?: string;
};

/**
 * One HTTP request with retries, backoff and classification.
 * Throws PlatformError; never returns a non-2xx.
 */
export async function request(
  url: string,
  ctx: FetchContext = {},
  opts: RequestOptions = {},
): Promise<RawResponse> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    treat404AsNotFound = true,
    platformId,
  } = opts;

  const fail = (kind: PlatformErrorKind, status: number, msg: string, body?: string) =>
    new PlatformError(kind, status, msg, platformId, body);

  for (let attempt = 0; ; attempt++) {
    const left = remainingMs(ctx.deadline);
    if (left < MIN_CALL_MS) {
      throw fail("budget", 0, "Chunk budget exhausted before request");
    }

    // Clamping to the remaining budget is what makes overrun structurally
    // impossible rather than merely unlikely: the signal aborts an in-flight
    // request, not just a not-yet-started one.
    const effectiveTimeout = Math.min(timeoutMs, left);

    let res: Response;
    try {
      res = await fetch(applyProxy(url), {
        method,
        headers: { ...BROWSER_HEADERS, ...headers },
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(effectiveTimeout),
      });
    } catch (e: unknown) {
      const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
      if (isTimeout && !hasBudget(ctx.deadline)) {
        throw fail("budget", 408, "Chunk budget exhausted mid-request");
      }
      if (isTimeout && attempt < MAX_ATTEMPTS - 1) {
        const wait = 1500 * 2 ** attempt;
        if (!hasBudget(ctx.deadline, wait + MIN_CALL_MS)) {
          throw fail("budget", 408, "Chunk budget exhausted before retry");
        }
        await sleep(wait);
        continue;
      }
      throw fail(
        "fail",
        isTimeout ? 408 : 0,
        isTimeout
          ? `Request timed out after ${effectiveTimeout}ms`
          : `Network error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Read the body BEFORE classifying, so every error carries it. Several
    // platforms put the useful detail in the body of a non-2xx — Codeforces
    // names the offending handle in the body of a 400 — and throwing that away
    // is what turns one bad handle into a whole failed batch.
    const text = await res.text();

    // ── 404: the handle is wrong. Never retried — retrying a typo just wastes
    //    the rate-limit budget that the valid handles need.
    if (res.status === 404 && treat404AsNotFound) {
      throw fail("not_found", 404, "Profile not found", text);
    }

    // ── 429 / 5xx: they are throttling or broken. Back off and retry.
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS - 1) {
        throw fail(
          "throttle",
          res.status,
          `HTTP ${res.status} after ${MAX_ATTEMPTS} attempts`,
          text,
        );
      }
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const wait = retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt;
      if (!hasBudget(ctx.deadline, wait + MIN_CALL_MS)) {
        throw fail("throttle", res.status, `HTTP ${res.status} — no budget left to retry`, text);
      }
      await sleep(wait);
      continue;
    }

    // ── 403 / 503: almost always a bot wall rather than a real permission
    //    error. Classified as throttle so the circuit breaker parks the
    //    platform instead of the worker blaming ~340 innocent handles.
    if (res.status === 403 || res.status === 503) {
      throw fail("throttle", res.status, `Blocked by origin (HTTP ${res.status})`, text);
    }

    if (!res.ok) {
      throw fail("fail", res.status, `HTTP ${res.status}`, text);
    }

    if (looksLikeChallenge(text)) {
      throw fail("throttle", res.status, "Bot challenge interstitial returned instead of content");
    }

    return {
      status: res.status,
      body: text,
      contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(),
    };
  }
}

/** request() + JSON.parse, with a parse failure reported as parse_error. */
export async function getJson<T>(
  url: string,
  ctx: FetchContext = {},
  opts: RequestOptions = {},
): Promise<T> {
  const res = await request(url, ctx, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
  try {
    return JSON.parse(res.body) as T;
  } catch {
    // Reaching a URL and getting non-JSON back means the endpoint changed shape.
    // That is an adapter problem, and calling it anything else would let a site
    // redesign masquerade as a student with no data.
    throw new PlatformError(
      "parse_error",
      res.status,
      `Expected JSON, got ${res.contentType || "unknown"} (${res.body.length}b)`,
      opts.platformId,
      res.body.slice(0, 2000),
    );
  }
}

/**
 * Extract the first balanced {...} object containing `needle`.
 *
 * Needed because several platforms embed their state as escaped JSON inside a
 * script stream (GeeksforGeeks' RSC payload) or a bare JS assignment
 * (CodeChef's `var all_rating = [...]`), where there is no element to select and
 * a non-greedy regex cannot balance braces.
 */
export function extractEnclosingJson(text: string, needle: string): string | null {
  const idx = text.indexOf(needle);
  if (idx === -1) return null;

  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return null;

  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail loud: a parser that cannot find what it needs must never return a default. */
export function parseAssert(
  condition: unknown,
  platformId: string,
  what: string,
): asserts condition {
  if (!condition) {
    throw new PlatformError(
      "parse_error",
      200,
      `${platformId}: could not extract ${what} — the page layout has probably changed`,
      platformId,
    );
  }
}
