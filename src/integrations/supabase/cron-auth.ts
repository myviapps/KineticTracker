import { createHash, timingSafeEqual } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Constant-time secret comparison.
 *
 * Hashing both sides to a fixed 32 bytes first is deliberate: `timingSafeEqual`
 * throws on length mismatch, and comparing raw strings would leak the secret's
 * length through that throw. SHA-256 makes both operands the same size, so the
 * comparison is total and reveals nothing.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Gate for every `/api/public/**` route.
 *
 * NOTE: there is deliberately no `x-vercel-cron` short-circuit here. That header
 * is an ordinary request header — Vercel sets it on its own cron invocations but
 * does not strip a client-supplied one, so trusting it un-gated every endpoint
 * under /api/public (including cron/seed-demo, which WRITES to production) to
 * anyone who sent the header. Vercel Cron authenticates by sending
 * `Authorization: Bearer $CRON_SECRET` automatically whenever a CRON_SECRET
 * environment variable is set on the project, so the secret path below covers
 * platform cron, GitHub Actions, and manual invocation identically.
 */
export function requireCronSecret(): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET not configured");

  const request = getRequest();

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";

  if (!provided || !safeEqual(secret, provided)) {
    throw new Error("Unauthorized: invalid or missing CRON_SECRET");
  }
}
