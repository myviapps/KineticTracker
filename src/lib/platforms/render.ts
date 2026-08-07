// Fetching a page that will not come back from a plain HTTP GET.
//
// Four of the remaining platforms are unreachable with `request()`:
//   hackerearth · interviewbit · code360 — JS-rendered, the useful numbers are
//                                          not in the served HTML at all
//   spoj                                 — 403 Cloudflare challenge, even from
//                                          a residential IP
//
// The adapters are written against THIS function rather than against a browser,
// so they are real code today and start returning data the moment a renderer is
// configured. Nothing about an adapter changes when the sidecar appears.
//
// ── Why a sidecar and not a library ────────────────────────────────────────
// Scrapling is Python and its stealth fetchers need Playwright's Chromium. That
// cannot live in a serverless function, so it runs as a small separate service
// exposing one endpoint. All parsing stays here in TypeScript with the other
// adapters — the service only ever hands back HTML.
//
// Deliberately NOT modelled on PLATFORM_PROXY_TEMPLATE (see http.ts). That
// template exists for commercial proxies that wrap a URL and return the body
// verbatim; a renderer needs to be told what to wait for and whether to solve a
// challenge, which does not fit in a query string.

import { request, remainingMs } from "./http";
import { PlatformError, type FetchContext } from "./types";

/** Base URL of the Scrapling sidecar, e.g. https://scrape.internal:8000 */
const SERVICE_URL = () => process.env.SCRAPLING_URL?.replace(/\/+$/, "") ?? "";
/** Shared secret; the sidecar rejects anything else. */
const SERVICE_TOKEN = () => process.env.SCRAPLING_TOKEN ?? "";

export function hasRenderer(): boolean {
  return SERVICE_URL().length > 0;
}

export type RenderOptions = {
  /** CSS selector to wait for before returning. The strongest readiness signal. */
  waitFor?: string;
  /** Ask the renderer to solve a Cloudflare interstitial. Slower; only when needed. */
  solveCloudflare?: boolean;
  /** Extra settle time in ms after load, for pages with no stable selector. */
  settleMs?: number;
  /**
   * Raise the renderer's own ceiling for a platform that is genuinely slow.
   *
   * The sidecar defaults to 26s, which is ample everywhere except Code360
   * (~29.5s measured). Bounded on the far side by the service's MAX_CEILING_MS,
   * and it never extends OUR deadline — `serviceBound` below is still derived
   * from the chunk budget and still shortens it.
   */
  ceilingMs?: number;
  platformId?: string;
};

type RenderResponse = { html?: string; status?: number; error?: string };

/**
 * Fetch a page as a real browser would see it.
 *
 * Falls back to a plain `request()` when no renderer is configured. That
 * fallback is not a workaround — it is the honest outcome: for a JS-rendered
 * page it returns a shell the adapter then fails to parse, and for SPOJ
 * `request()` already classifies the Cloudflare interstitial as `throttle`. In
 * both cases the failure names the missing renderer instead of blaming the
 * student's handle, which is the distinction the worker acts on.
 */
export async function renderedRequest(
  url: string,
  ctx: FetchContext = {},
  opts: RenderOptions = {},
): Promise<string> {
  const base = SERVICE_URL();
  const { platformId } = opts;

  if (!base) {
    if (opts.solveCloudflare) {
      // Sending this to `request()` would burn a retry cycle to reach a
      // conclusion already known: no renderer, no chance.
      throw new PlatformError(
        "throttle",
        0,
        `${platformId ?? "This platform"} needs browser rendering — set SCRAPLING_URL to enable it`,
        platformId,
      );
    }
    const res = await request(url, ctx, { platformId });
    return res.body;
  }

  const left = remainingMs(ctx.deadline);
  /*
    Rendering is slow, and a Cloudflare solve is slower than it looks: Scrapling
    silently raises any sub-60s timeout to 60s on that path, so the sidecar's own
    outer bound is the only real limit. Against a 50s chunk budget that means a
    solve can outlive the chunk it runs in.

    Starting one anyway is worse than skipping it. The client would abort at its
    own deadline while the sidecar carried on rendering for another half-minute,
    holding a browser slot for a request nobody is waiting for — so the accounts
    behind it lose their turn too.
  */
  // A platform that asked for a raised ceiling needs that much budget to be
  // worth starting; otherwise we would launch a browser purely to abort it.
  const need = opts.solveCloudflare ? 32_000 : Math.max(12_000, (opts.ceilingMs ?? 0) + 4_000);
  if (left < need) {
    throw new PlatformError(
      "budget",
      0,
      `Not enough budget to render (${Math.round(left)}ms left, needs ~${need}ms)`,
      platformId,
    );
  }

  /*
    Reserve enough for the sidecar to answer after it gives up. `timeoutMs` below
    tells it OUR bound so it returns a proper "blocked" JSON — which the worker
    reads as a throttle against the platform — instead of us aborting blind and
    recording a budget error that says nothing about whether the site is up.
  */
  const serviceBound = Math.max(5_000, left - 4_000);
  /*
    Our own abort must outlast the sidecar's, or we hang up on a render that was
    about to succeed and record a `budget` error for a site that was fine.

    The 30s default was exactly that bug for Code360: the sidecar was allowed 42s
    while this line cut the socket at 30s, so raising the service ceiling alone
    would have changed nothing.
  */
  const clientCap = opts.solveCloudflare ? 60_000 : Math.max(30_000, (opts.ceilingMs ?? 0) + 3_000);
  const timeout = Math.min(left - 1_000, clientCap);

  let res: Response;
  try {
    res = await fetch(`${base}/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SERVICE_TOKEN() ? { authorization: `Bearer ${SERVICE_TOKEN()}` } : {}),
      },
      body: JSON.stringify({
        url,
        wait_for: opts.waitFor ?? null,
        solve_cloudflare: opts.solveCloudflare ?? false,
        settle_ms: opts.settleMs ?? 0,
        ceiling_ms: opts.ceilingMs ?? null,
        // The sidecar clamps this to its own ceiling; it only ever shortens.
        timeout_ms: serviceBound,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e: unknown) {
    const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
    throw new PlatformError(
      isTimeout ? "budget" : "fail",
      isTimeout ? 408 : 0,
      // Named as OUR service, not the platform's: a sidecar that is down must
      // not read as "this student's handle is bad".
      `Render service ${isTimeout ? "timed out" : "unreachable"}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      platformId,
    );
  }

  const text = await res.text();

  if (res.status === 404) {
    throw new PlatformError("not_found", 404, "Profile not found", platformId, text);
  }
  if (!res.ok) {
    throw new PlatformError(
      res.status === 429 || res.status >= 500 ? "throttle" : "fail",
      res.status,
      `Render service returned HTTP ${res.status}`,
      platformId,
      text.slice(0, 500),
    );
  }

  let parsed: RenderResponse;
  try {
    parsed = JSON.parse(text) as RenderResponse;
  } catch {
    throw new PlatformError(
      "parse_error",
      res.status,
      "Render service returned a non-JSON body",
      platformId,
      text.slice(0, 500),
    );
  }

  if (parsed.error) {
    // The renderer reached the site and still could not get through — that is a
    // throttle, not a broken parser.
    throw new PlatformError("throttle", parsed.status ?? 0, parsed.error, platformId);
  }
  if (parsed.status === 404) {
    throw new PlatformError("not_found", 404, "Profile not found", platformId);
  }
  if (!parsed.html) {
    throw new PlatformError(
      "parse_error",
      parsed.status ?? 0,
      "Renderer returned no HTML",
      platformId,
    );
  }

  return parsed.html;
}
