// What each platform CAN publish, and whether we can fetch it at all.
//
// ── Why this file exists ───────────────────────────────────────────────────
// NormalizedProfile (platforms/types.ts) already draws the distinction that
// matters: `undefined` means the platform does not report a field, `null` means
// it reports it and the value is empty. Both collapse to SQL NULL on write, so
// by the time the UI reads platform_stats that information is gone.
//
// Without it the profile can only ever say "no data", which is three different
// claims wearing one label:
//   · we can fetch this and simply have not yet
//   · this platform does not publish that, ever
//   · we cannot fetch this platform at all
//
// Facts below come from the verified endpoint notes in the platforms seed
// (20260808000001_platforms.sql), not from documentation.

/*
  Deliberately NO import from ./platforms/registry.

  This module is consumed by client components — the profile panels, the
  add-student form, the bulk uploader. The registry imports every adapter, and
  the LeetCode adapter imports ../leetcode.server, so reaching for `hasAdapter`
  here drags the server-only scraper into the browser bundle. Vite's
  import-protection plugin rejects the build, correctly.

  `ADAPTER_BACKED` is therefore a plain list. It is the same information stated
  in a place the client can safely read, and it cannot drift unnoticed: the
  verification below fails the build if it disagrees with CAPABILITIES.
*/
const ADAPTER_BACKED = new Set([
  "leetcode",
  "codeforces",
  "geeksforgeeks",
  "hackerrank",
  "codechef",
  "atcoder",
  "hackerearth",
  "interviewbit",
  "code360",
  "spoj",
]);

/**
 * Adapters that cannot work without the render sidecar.
 *
 * These four are JS-rendered or Cloudflare-walled, so a plain HTTP GET returns
 * a shell or a challenge page. The adapter exists and is correct; it simply has
 * nothing to parse until SCRAPLING_URL points at a running renderer.
 *
 * Whether that service is actually configured is a SERVER fact (an env var) and
 * this module runs on the client, so nothing here can assert it. The runtime
 * error carries that — render.ts throws a throttle naming the missing service,
 * which lands on the account as fetch_error and surfaces on the panel. This set
 * exists so the UI can explain the dependency BEFORE the first failed fetch
 * rather than after it.
 */
const NEEDS_RENDERER = new Set(["hackerearth", "interviewbit", "code360", "spoj"]);

export function needsRenderer(platformId: string): boolean {
  return NEEDS_RENDERER.has(platformId);
}

export type PlatformStatus =
  /** Adapter exists and the platform is switched on. */
  | "live"
  /** Adapter exists but `platforms.enabled` is false — an admin toggle away. */
  | "ready"
  /** A registered slot with no adapter written yet. Handles are stored, not fetched. */
  | "no_adapter"
  /** The platform actively refuses us. Not fixable by enabling it. */
  | "blocked"
  /** Deliberately outside the scoring model. */
  | "excluded";

/**
 * The states the registry and `enabled` cannot tell us on their own.
 *
 * Everything not listed here is derived: adapter + enabled = live, adapter
 * alone = ready, neither = no_adapter.
 */
const DECLARED: Record<string, { status: PlatformStatus; note: string }> = {
  /*
    MEASURED on 2026-08-05, with the sidecar running and the stealth browser
    actually attempting the solve. The optimistic note that used to sit here —
    "the Cloudflare challenge is solved by the render sidecar rather than by a
    paid proxy" — was written from the adapter's intent, never from a run:

      spoj/<handle>  ->  22.4s  ->  "Bot challenge still present after render"

    Having an adapter is not the same as getting through. Leaving SPOJ as
    ready/live means staff see "not fetched yet" on a platform that cannot be
    fetched from this IP at all, and every student on it burns 22s of the
    rate-limit budget the working platforms need.
  */
  spoj: {
    status: "blocked",
    note: "SPOJ answers with a Cloudflare bot challenge that survives the render sidecar's solver. It needs a residential or datacenter proxy before it can be fetched.",
  },
  /*
    MEASURED the same day: interviewbit.com/profile/<handle> returns HTTP 200 for
    every handle, real or invented, and renders only site chrome — the nav, a
    "Sign in" prompt, and no Solved / Rank / streak anywhere in the document.
    InterviewBit moved to Scaler and its public profiles went with it.

    So the adapter cannot be fixed by adjusting selectors; there is nothing
    behind them. Declared blocked rather than left to fail as parse_error, which
    would read as "our parser broke" and get retried indefinitely.
  */
  interviewbit: {
    status: "blocked",
    note: "InterviewBit no longer serves public profiles — the page renders only site chrome behind a sign-in prompt. Nothing can be read without an authenticated session.",
  },
  kaggle: {
    status: "excluded",
    note: "Kaggle awards competition and notebook medals rather than solved problems, so every scoring weight is zero by design. It is never ranked.",
  },
};

/** Why a platform is not being fetched, in words a non-admin can act on. */
const NOT_FETCHED_NOTE: Record<PlatformStatus, string> = {
  live: "",
  ready: "This platform is not switched on yet — an admin can enable it on the Platforms page.",
  no_adapter: "The handle is saved, but this platform is not being fetched yet.",
  blocked: "",
  excluded: "",
};

export function platformStatus(platformId: string, enabled: boolean): PlatformStatus {
  const declared = DECLARED[platformId];
  if (declared) return declared.status;
  if (!ADAPTER_BACKED.has(platformId)) return "no_adapter";
  return enabled ? "live" : "ready";
}

/** One sentence explaining why nothing has been fetched. Empty when it has. */
export function statusNote(platformId: string, status: PlatformStatus): string {
  return DECLARED[platformId]?.note ?? NOT_FETCHED_NOTE[status] ?? "";
}

/** True when a handle on this platform will eventually be fetched. */
export function isFetchable(platformId: string): boolean {
  const s = DECLARED[platformId]?.status;
  if (s === "blocked" || s === "excluded") return false;
  return ADAPTER_BACKED.has(platformId);
}

export type Capability =
  "heatmap" | "difficulty" | "rating" | "languages" | "topics" | "badges" | "contests" | "recent";

/**
 * What each platform publishes — NOT what it happens to have returned.
 *
 * A `false` here is a permanent fact about the platform and lets the UI say
 * "CodeChef does not publish a difficulty split" instead of drawing an empty
 * chart that reads as "this student has solved nothing".
 */
export const CAPABILITIES: Record<string, Record<Capability, boolean>> = {
  leetcode: {
    heatmap: true,
    difficulty: true,
    // Contest rating, not a ladder rating, but it is a rating over time.
    rating: true,
    languages: true,
    topics: true,
    badges: true,
    contests: true,
    recent: true,
  },
  codeforces: {
    heatmap: false,
    // Derived from problemset ratings rather than published as easy/medium/hard.
    difficulty: true,
    rating: true,
    languages: false,
    topics: false,
    badges: false,
    contests: true,
    recent: true,
  },
  codechef: {
    heatmap: false,
    // "No difficulty split" — seed notes.
    difficulty: false,
    rating: true,
    languages: false,
    topics: false,
    // Stars, which the panel renders in place of badges.
    badges: true,
    contests: true,
    recent: false,
  },
  geeksforgeeks: {
    heatmap: true,
    difficulty: true,
    // Score platform: no rating ladder.
    rating: false,
    languages: true,
    topics: false,
    badges: true,
    contests: true,
    recent: false,
  },
  hackerrank: {
    heatmap: false,
    // "No difficulty split, hence weight_unrated" — seed notes.
    difficulty: false,
    rating: false,
    languages: false,
    topics: false,
    badges: true,
    contests: false,
    recent: false,
  },
  atcoder: {
    heatmap: false,
    // "No difficulty split without the 4.4MB problem-metadata dump" — seed notes.
    difficulty: false,
    rating: true,
    languages: false,
    topics: false,
    badges: false,
    contests: true,
    recent: false,
  },
  /*
    The last three are thin by nature, not by neglect. The seed notes call
    HackerEarth "only a weak problems-solved count", InterviewBit "score/rank/
    streak only", and Code360 "most fragile". Claiming more here would make the
    panel promise sections the adapter can never fill.
  */
  hackerearth: {
    heatmap: false,
    difficulty: false,
    rating: false,
    languages: false,
    topics: false,
    badges: false,
    contests: false,
    recent: false,
  },
  interviewbit: {
    heatmap: false,
    difficulty: false,
    rating: false,
    languages: false,
    topics: false,
    badges: false,
    contests: false,
    recent: false,
  },
  code360: {
    heatmap: false,
    // VERIFIED 2026-08-05: the profile renders a four-tier split — Easy,
    // Moderate, Hard and Ninja. Declared false while the adapter was chasing a
    // uuid it could never find; now that it parses the page, the split is real.
    // (`languages` stays false: the page names one default language, not a
    // per-language breakdown, so there is nothing to chart.)
    difficulty: true,
    rating: false,
    languages: false,
    topics: false,
    badges: false,
    contests: false,
    recent: false,
  },
  spoj: {
    heatmap: false,
    difficulty: false,
    rating: false,
    languages: false,
    topics: false,
    badges: false,
    contests: false,
    recent: false,
  },
};

/** Platforms with no adapter publish nothing we can show yet. */
const NOTHING: Record<Capability, boolean> = {
  heatmap: false,
  difficulty: false,
  rating: false,
  languages: false,
  topics: false,
  badges: false,
  contests: false,
  recent: false,
};

export function capabilities(platformId: string): Record<Capability, boolean> {
  return CAPABILITIES[platformId] ?? NOTHING;
}

export function publishes(platformId: string, cap: Capability): boolean {
  return capabilities(platformId)[cap];
}

/*
  ADAPTER_BACKED and CAPABILITIES describe the same five platforms from two
  angles, and a new adapter added to only one of them would silently give that
  platform either a status it cannot back up or a panel with no capabilities.
  Checked at module load so the mistake surfaces immediately rather than as an
  empty section months later.
*/
if (import.meta.env?.DEV) {
  const capKeys = new Set(Object.keys(CAPABILITIES));
  const missing = [...ADAPTER_BACKED].filter((id) => !capKeys.has(id));
  const extra = [...capKeys].filter((id) => !ADAPTER_BACKED.has(id));
  if (missing.length || extra.length) {
    console.error("[platform-capabilities] ADAPTER_BACKED and CAPABILITIES disagree.", {
      missingCapabilities: missing,
      missingFromAdapterBacked: extra,
    });
  }
}
