// Adapter registry. The worker resolves platforms through this and never
// imports an adapter directly, so turning a platform on is a row in
// `platforms.enabled` plus an entry here — never a change to the worker.

import type { PlatformAdapter } from "./types";
import { leetcodeAdapter } from "./leetcode";
import { codeforcesAdapter } from "./codeforces";
import { geeksforgeeksAdapter } from "./geeksforgeeks";
import { hackerrankAdapter } from "./hackerrank";
import { codechefAdapter } from "./codechef";
import { atcoderAdapter } from "./atcoder";
import { hackerearthAdapter } from "./hackerearth";
import { interviewbitAdapter } from "./interviewbit";
import { code360Adapter } from "./code360";
import { spojAdapter } from "./spoj";

const ADAPTERS: PlatformAdapter[] = [
  leetcodeAdapter,
  codeforcesAdapter,
  geeksforgeeksAdapter,
  hackerrankAdapter,
  codechefAdapter,
  // Direct HTTP, like the five above.
  atcoderAdapter,
  /*
    These four fetch through the render sidecar (see render.ts). Registering an
    adapter is NOT the same as switching a platform on: `platforms.enabled` is
    the operator's control and stays false for all four until SCRAPLING_URL
    points at a running renderer. Being in this list only means the worker knows
    how to fetch them if asked.
  */
  hackerearthAdapter,
  interviewbitAdapter,
  code360Adapter,
  spojAdapter,
];

const BY_ID = new Map<string, PlatformAdapter>(ADAPTERS.map((a) => [a.id, a]));

/**
 * Every platform now has an adapter except `kaggle`, which is excluded by
 * design — its scoring weights are all zero because it awards competition
 * medals rather than solved problems.
 *
 * Callers must still handle undefined; the worker skips a platform with no
 * adapter rather than failing the job.
 */
export function getAdapter(platformId: string): PlatformAdapter | undefined {
  return BY_ID.get(platformId);
}

export function hasAdapter(platformId: string): boolean {
  return BY_ID.has(platformId);
}

export function implementedPlatformIds(): string[] {
  return [...BY_ID.keys()];
}

export { ADAPTERS };
