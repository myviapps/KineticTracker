import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { log } from "@/lib/log.server";

/**
 * Per-IP token-bucket rate limiting for the unauthenticated endpoints.
 *
 * Why this exists: `/students/$roll` and the anonymous branch of `searchStudents`
 * are deliberately public — a student can check their own progress without an
 * account, and that flow is worth keeping. But roll numbers are close to
 * sequential (24CS001, 24CS002, …), so "public and unmetered" means the whole
 * directory is walkable one request at a time even with masking applied and even
 * after the anon view grants were revoked in 20260809000001. Masking limits WHAT
 * leaks per request; the limiter limits HOW MANY requests there are.
 *
 * State lives in Postgres rather than module memory because the app runs on
 * Vercel serverless: an in-process Map is per-instance, resets on cold start, and
 * an attacker spreading requests across instances would never hit it.
 *
 * The IP is stored as a truncated SHA-256 rather than in the clear — the limiter
 * needs to recognise a repeat caller, not to know who they are.
 */

type LimitKind = "search" | "profile";

const LIMITS: Record<LimitKind, { capacity: number; refillPerSec: number }> = {
  // ~30 lookups up front, then one every two seconds. A student checking their
  // own roll never notices; a scraper walking 5,000 rolls takes ~3 hours.
  search: { capacity: 30, refillPerSec: 0.5 },
  // Profile pages fan out to a few requests per view, so the bucket is deeper.
  profile: { capacity: 60, refillPerSec: 1 },
};

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests. Please wait a moment and try again.");
    this.name = "RateLimitError";
  }
}

/**
 * Vercel puts the real client address at the head of x-forwarded-for. Everything
 * after the first hop is caller-controlled, so only the first entry is used.
 */
function clientIp(): string {
  const h = getRequest().headers;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "unknown";
}

export async function requirePublicRateLimit(kind: LimitKind): Promise<void> {
  const { capacity, refillPerSec } = LIMITS[kind];
  const bucket = `${kind}:${createHash("sha256").update(clientIp()).digest("hex").slice(0, 32)}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Not in the generated types until `npm run gen-types` is re-run against the
  // 20260809000002 migration, hence the cast. Cast the CLIENT, not the method —
  // pulling `.rpc` off the object loses its `this` and supabase-js dies on
  // `this.rest`. (Same reasoning as refresh-worker.server.ts.)
  const client = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
  };

  const { data, error } = await client.rpc("rate_limit_take", {
    _bucket: bucket,
    _capacity: capacity,
    _refill_per_sec: refillPerSec,
  });

  // Fail OPEN on limiter failure, deliberately. This is an anti-abuse control in
  // front of already-masked data, not an authorization boundary — those are in
  // authz.ts and RLS. Taking the public student lookup down because one RPC
  // errored would trade a real outage for a marginal security gain. The warn is
  // the signal that it happened.
  if (error) {
    log.warn("rate-limit", `limiter unavailable, allowing request: ${error.message ?? "unknown"}`);
    return;
  }

  if (data === false) throw new RateLimitError();
}
