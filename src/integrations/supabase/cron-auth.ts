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
export class CronAuthError extends Error {
  constructor(readonly reason: "unconfigured" | "invalid") {
    super(
      reason === "unconfigured"
        ? "CRON_SECRET is not configured on this deployment"
        : "Unauthorized: invalid or missing CRON_SECRET",
    );
    this.name = "CronAuthError";
  }
}

export function requireCronSecret(): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new CronAuthError("unconfigured");

  const request = getRequest();

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";

  if (!provided || !safeEqual(secret, provided)) {
    throw new CronAuthError("invalid");
  }
}

/**
 * Route guard: returns a Response to short-circuit with, or null when the
 * caller is authorized.
 *
 * Exists because all four /api/public routes had `catch { return 401 }`, which
 * collapsed two very different failures into one status. A missing CRON_SECRET
 * on the deployment is OUR misconfiguration and nothing the caller sends can
 * fix it, but it looked exactly like a wrong secret — so debugging a dead cron
 * meant guessing between "not set in Vercel" and "does not match GitHub".
 *
 * Reporting 500 for the unconfigured case is not a credential oracle: the answer
 * does not depend on what the caller supplied, so it tells an attacker only that
 * the endpoint is broken, which they can already tell.
 */
export function cronGuard(): Response | null {
  try {
    requireCronSecret();
    return null;
  } catch (e) {
    if (e instanceof CronAuthError && e.reason === "unconfigured") {
      return Response.json(
        { error: "CRON_SECRET is not configured on this deployment" },
        { status: 500 },
      );
    }
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
