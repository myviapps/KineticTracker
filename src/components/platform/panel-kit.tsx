import { ExternalLink, Lock, PlugZap, Clock } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import type { StudentPlatformSummary } from "@/lib/students.functions";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION } from "@/lib/chart-motion";
import { cn } from "@/lib/utils";
import type { CalendarMap } from "@/lib/date-buckets";
import {
  capabilities,
  platformStatus,
  statusNote,
  type Capability,
  type PlatformStatus,
} from "@/lib/platform-capabilities";

/**
 * Shared parts every platform panel is built from.
 *
 * The panels are bespoke — Codeforces leads with a rank title, CodeChef with
 * stars and a division, GeeksforGeeks with an institute rank — because those are
 * how each community actually describes standing, and flattening them into one
 * generic tile row is what made four of five platforms feel like an afterthought.
 *
 * What they share is the SCAFFOLD, so the page still reads as one page: the same
 * card, the same heading treatment, the same three empty states.
 */

// ────────────────────────────────────────────────────────────────────────────
// Sections
// ────────────────────────────────────────────────────────────────────────────

/**
 * One card.
 *
 * `capability` is what separates the two silences that used to look identical.
 * A platform that CAN publish this and has not yet says "no data yet"; one that
 * never will says so by name. Rendering an empty chart for the second is a
 * claim about the student rather than about the platform.
 */
export function PanelSection({
  title,
  platformId,
  platformName,
  capability,
  hasData,
  right,
  children,
}: {
  title: string;
  platformId: string;
  platformName: string;
  capability?: Capability;
  hasData: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const supported = capability ? capabilities(platformId)[capability] : true;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>{title}</SectionTitle>
        {right}
      </div>

      {!supported ? (
        <p className="text-sm text-muted-foreground">
          {platformName} does not publish {title.toLowerCase()}.
        </p>
      ) : !hasData ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-3.5" aria-hidden /> No data yet.
        </p>
      ) : (
        children
      )}
    </div>
  );
}

/** The header every panel opens with: who this is, and where they stand. */
export function IdentityBanner({
  p,
  headline,
  sub,
  tone,
}: {
  p: StudentPlatformSummary;
  /** The platform's own idea of standing — "Expert", "Div 2 ★★★★". */
  headline?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold">{p.name}</h2>
            {headline && (
              <span className={cn("text-lg font-bold", tone ?? "text-primary")}>{headline}</span>
            )}
          </div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-2xs text-muted-foreground">
            {p.profile_url ? (
              <a
                href={p.profile_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 hover:text-primary"
              >
                @{p.handle} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>@{p.handle}</span>
            )}
            {p.stats?.fetched_at && (
              <span>· updated {new Date(p.stats.fetched_at).toLocaleDateString()}</span>
            )}
            {p.stats?.fetch_status === "partial" && (
              <span className="text-medium">· still filling in</span>
            )}
            {p.fetch_error && <span className="text-hard">· {p.fetch_error}</span>}
          </div>
        </div>

        {p.rank && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              Rank by {p.rank.metric}
            </div>
            <div className="text-lg font-bold text-primary">
              #{p.rank.college_rank}
              <span className="text-sm text-muted-foreground">/{p.rank.college_total}</span>
            </div>
            <div className="font-mono text-3xs text-muted-foreground">
              #{p.rank.overall_rank} of {p.rank.overall_total} on {p.name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type Tile = { label: string; value: string; hint?: string };

export function TileRow({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <StatCard key={t.label} label={t.label} value={t.value} hint={t.hint} />
      ))}
    </div>
  );
}

/**
 * The whole-panel state for a platform nothing will fetch.
 *
 * Distinct from an empty section on purpose: "Nothing fetched for this account
 * yet" is a promise, and for a platform with no adapter — or one Cloudflare
 * refuses outright — it is a promise the app cannot keep.
 */
export function UnavailablePanel({
  name,
  platformId,
  status,
  handle,
}: {
  name: string;
  platformId: string;
  status: PlatformStatus;
  handle: string;
}) {
  const Icon = status === "blocked" ? Lock : PlugZap;
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
      <Icon className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-bold">{name}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {statusNote(platformId, status)}
      </p>
      <p className="mt-3 font-mono text-2xs text-muted-foreground">
        Saved handle: <span className="text-foreground">@{handle}</span>
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable visuals
// ────────────────────────────────────────────────────────────────────────────

export function DifficultyBars({
  easy,
  medium,
  hard,
  unrated,
  total,
}: {
  easy?: number | null;
  medium?: number | null;
  hard?: number | null;
  unrated?: number | null;
  total: number;
}) {
  return (
    <div className="space-y-2">
      <Bar label="Easy" value={easy ?? 0} total={total} tone="easy" />
      <Bar label="Medium" value={medium ?? 0} total={total} tone="medium" />
      <Bar label="Hard" value={hard ?? 0} total={total} tone="hard" />
      {unrated ? <Bar label="Unrated" value={unrated} total={total} tone="muted" /> : null}
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "easy" | "medium" | "hard" | "muted";
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const fill =
    tone === "easy"
      ? "bg-easy"
      : tone === "medium"
        ? "bg-medium"
        : tone === "hard"
          ? "bg-hard"
          : "bg-muted-foreground/50";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="font-bold">
          {value.toLocaleString()}
          <span className="ml-1 font-normal text-muted-foreground">{pct}%</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export type RatingPoint = { rating: number; label: string; at: string; rank?: number | null };

/**
 * Normalise the two rating-history shapes the adapters emit.
 * Codeforces: {new_rating, at, name, rank}. CodeChef: {rating, end, name, rank}.
 */
export function toRatingHistory(raw: unknown): RatingPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      const r = h as Record<string, unknown>;
      const rating = typeof r.new_rating === "number" ? r.new_rating : r.rating;
      return {
        rating: typeof rating === "number" ? rating : NaN,
        label: typeof r.name === "string" ? r.name : "",
        at: typeof r.at === "string" ? r.at : typeof r.end === "string" ? r.end : "",
        rank: typeof r.rank === "number" ? r.rank : null,
      };
    })
    .filter((h) => Number.isFinite(h.rating));
}

export function RatingChart({ history }: { history: RatingPoint[] }) {
  const [cPrimary, cBorder, cSurface, cMutedFg] = useCssVars(
    "--primary",
    "--border",
    "--surface",
    "--muted-foreground",
  );
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cBorder} />
          <XAxis
            dataKey="at"
            tick={{ fontSize: 10, fill: cMutedFg }}
            tickFormatter={(v) => String(v).slice(0, 7)}
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 10, fill: cMutedFg }}
            domain={["dataMin - 100", "dataMax + 100"]}
          />
          <Tooltip
            contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12 }}
            labelFormatter={(v) => String(v).slice(0, 10)}
          />
          <Line
            {...CHART_MOTION}
            type="monotone"
            dataKey="rating"
            stroke={cPrimary}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The contests behind the rating line.
 *
 * The adapters store a contest NAME and RANK against every rating point and the
 * chart threw both away — "1687" tells you where they ended up, "#412 in Div 2
 * Round 918" tells you how.
 */
export function ContestTable({ history }: { history: RatingPoint[] }) {
  // Newest first: the last few contests are what anyone actually looks for.
  const rows = [...history].reverse().slice(0, 15);
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface font-mono text-3xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2">Contest</th>
            <th className="px-2 py-1.5 text-right">Rank</th>
            <th className="px-2 py-1.5 text-right">Rating</th>
            <th className="py-1.5 pl-2 text-right">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((h, i) => {
            // The NEXT row in this reversed list is the previous contest.
            const prev = rows[i + 1];
            const delta = prev ? h.rating - prev.rating : null;
            return (
              <tr key={`${h.at}-${i}`} className="hover:bg-muted/30">
                <td className="py-1.5 pr-2">
                  <div className="truncate" title={h.label}>
                    {h.label || "—"}
                  </div>
                  <div className="font-mono text-3xs text-muted-foreground">
                    {h.at ? String(h.at).slice(0, 10) : ""}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {h.rank ? `#${h.rank.toLocaleString()}` : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">
                  {Math.round(h.rating).toLocaleString()}
                </td>
                <td
                  className={cn(
                    "py-1.5 pl-2 text-right font-mono",
                    delta === null
                      ? "text-muted-foreground"
                      : delta > 0
                        ? "text-easy"
                        : delta < 0
                          ? "text-hard"
                          : "text-muted-foreground",
                  )}
                >
                  {delta === null ? "—" : delta > 0 ? `+${delta}` : delta}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Solved-over-time, from this platform's own daily_snapshots. */
export function SolvedOverTime({
  history,
}: {
  history: { snapshot_date: string; total_solved: number }[];
}) {
  const [cPrimary, cBorder, cSurface, cMutedFg] = useCssVars(
    "--primary",
    "--border",
    "--surface",
    "--muted-foreground",
  );
  const data = history.map((h) => ({
    date: h.snapshot_date.slice(5),
    solved: h.total_solved,
  }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={cBorder} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: cMutedFg }} minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: cMutedFg }} domain={["dataMin - 5", "dataMax + 5"]} />
          <Tooltip
            contentStyle={{ background: cSurface, border: `1px solid ${cBorder}`, fontSize: 12 }}
          />
          <Line
            {...CHART_MOTION}
            type="monotone"
            dataKey="solved"
            stroke={cPrimary}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a platform's heatmap into the shape <Heatmap> expects.
 *
 * CalendarMap is keyed by epoch-SECONDS at UTC midnight, because that is
 * LeetCode's own format and the component was written against it. GeeksforGeeks
 * emits date strings. Passing those straight through produces keys that never
 * match a lookup, so the grid renders every day empty — silently, with no error.
 */
export function toCalendarMap(raw: unknown): CalendarMap {
  if (!raw || typeof raw !== "object") return {};
  const out: CalendarMap = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(count) || count <= 0) continue;

    // Already epoch-seconds (LeetCode).
    if (/^\d{9,11}$/.test(key)) {
      out[key] = (out[key] ?? 0) + count;
      continue;
    }

    const parsed = Date.parse(key.length <= 10 ? `${key}T00:00:00Z` : key);
    if (Number.isNaN(parsed)) continue;
    const d = new Date(parsed);
    const utcMidnight = Math.floor(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
    );
    const k = String(utcMidnight);
    out[k] = (out[k] ?? 0) + count;
  }

  return out;
}

/** Read a value out of an adapter's untyped `data` blob. */
export function blob(p: StudentPlatformSummary): Record<string, unknown> {
  return (p.stats?.data ?? {}) as Record<string, unknown>;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : Math.round(v).toLocaleString();
}

/** The status of the platform this panel is rendering. */
export function statusOf(p: StudentPlatformSummary): PlatformStatus {
  return platformStatus(p.platform_id, p.enabled);
}
