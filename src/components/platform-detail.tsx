import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ExternalLink } from "lucide-react";

import type { StudentPlatformSummary } from "@/lib/students.functions";
import { StatCard, SectionTitle } from "@/components/stat-card";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION } from "@/lib/chart-motion";

/**
 * Deep view for one platform.
 *
 * Generic on purpose. LeetCode has a bespoke layout because it exposes far more
 * than anything else (calendar, tag graph, language split); every other platform
 * publishes some subset of {solved, difficulty, rating history, per-track
 * scores}. Writing five near-identical components would mean five places to fix
 * when the shared shape changes.
 *
 * Sections render only when the platform actually provides the data. An empty
 * card captioned "no data" teaches nothing and implies something is broken.
 */

type RatingPoint = {
  rating?: number;
  name?: string;
  new_rating?: number;
  at?: string;
  end?: string;
};
type Track = {
  name?: string | null;
  practice_score?: number | null;
  practice_rank?: number | null;
  contest_score?: number | null;
};
type Badge = {
  name?: string | null;
  stars?: number | null;
  solved?: number | null;
  total?: number | null;
  rank?: number | null;
};

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function PlatformDetail({ p }: { p: StudentPlatformSummary }) {
  const [cPrimary, cBorder, cSurface, cMutedFg] = useCssVars(
    "--primary",
    "--border",
    "--surface",
    "--muted-foreground",
  );

  const s = p.stats;
  const d = (p.stats?.data ?? {}) as Record<string, unknown>;

  if (!s) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <SectionTitle>{p.name}</SectionTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing fetched for this account yet.
          {p.fetch_error ? ` Last attempt: ${p.fetch_error}` : ""}
        </p>
      </div>
    );
  }

  // Normalise the two rating-history shapes: Codeforces emits {new_rating, at},
  // CodeChef emits {rating, end}.
  const history = (Array.isArray(d.rating_history) ? (d.rating_history as RatingPoint[]) : [])
    .map((h) => ({
      rating: n(h.new_rating) ?? n(h.rating),
      label: h.name ?? "",
      at: h.at ?? h.end ?? "",
    }))
    .filter((h): h is { rating: number; label: string; at: string } => h.rating !== null);

  const tracks = (Array.isArray(d.tracks) ? (d.tracks as Track[]) : []).filter(
    (t) => n(t.practice_score) || n(t.contest_score),
  );
  const badges = (Array.isArray(d.badges) ? (d.badges as Badge[]) : []).filter((b) => n(b.solved));

  const tiles: { label: string; value: string; hint?: string }[] = [];
  const push = (label: string, v: number | null, hint?: string) => {
    if (v !== null) tiles.push({ label, value: v.toLocaleString(), hint });
  };
  push("Solved", n(s.total_solved));
  push("Rating", n(s.rating), s.max_rating ? `peak ${Math.round(s.max_rating)}` : undefined);
  push("Global Rank", n(s.global_rank));
  push("Country Rank", n(s.country_rank));
  push("Institute Rank", n(s.institute_rank));
  push("Score", n(s.platform_score));
  push("Stars", n(s.stars));
  push("Streak", n(s.streak), "days");
  push("Contests", n(s.contests_attended));

  const hasDifficulty =
    n(s.easy_solved) !== null || n(s.medium_solved) !== null || n(s.hard_solved) !== null;

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{p.name}</h2>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-muted-foreground">
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
              {s.fetched_at && <span>· updated {new Date(s.fetched_at).toLocaleDateString()}</span>}
              {s.fetch_status === "partial" && (
                <span className="text-medium">· still filling in</span>
              )}
            </div>
          </div>
          {p.rank && (
            <div className="text-right">
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

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <StatCard key={t.label} label={t.label} value={t.value} hint={t.hint} />
          ))}
        </div>
      )}

      {hasDifficulty && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <SectionTitle>Difficulty Breakdown</SectionTitle>
          <div className="mt-3 space-y-2">
            <Bar
              label="Easy"
              value={n(s.easy_solved) ?? 0}
              total={s.total_solved ?? 0}
              tone="easy"
            />
            <Bar
              label="Medium"
              value={n(s.medium_solved) ?? 0}
              total={s.total_solved ?? 0}
              tone="medium"
            />
            <Bar
              label="Hard"
              value={n(s.hard_solved) ?? 0}
              total={s.total_solved ?? 0}
              tone="hard"
            />
            {n(s.unrated_solved) ? (
              <Bar
                label="Unrated"
                value={n(s.unrated_solved) ?? 0}
                total={s.total_solved ?? 0}
                tone="muted"
              />
            ) : null}
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <SectionTitle>Rating Over Time</SectionTitle>
          <div className="mt-3 h-56">
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
                  contentStyle={{
                    background: cSurface,
                    border: `1px solid ${cBorder}`,
                    fontSize: 12,
                  }}
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
          <p className="mt-1 font-mono text-3xs text-muted-foreground">
            {history.length} rated contests
          </p>
        </div>
      )}

      {badges.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <SectionTitle>Tracks</SectionTitle>
          <div className="mt-3 space-y-2">
            {badges.map((b, i) => (
              <div key={`${b.name}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate">{b.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {b.solved}
                  {b.total ? `/${b.total}` : ""}
                </span>
                {n(b.stars) ? (
                  <span className="font-mono text-xs text-primary">
                    {"★".repeat(Math.min(b.stars!, 6))}
                  </span>
                ) : null}
                {n(b.rank) ? (
                  <span className="ml-auto font-mono text-3xs text-muted-foreground">
                    rank #{b.rank!.toLocaleString()}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {tracks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <SectionTitle>Scores by Track</SectionTitle>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {tracks.slice(0, 12).map((t, i) => (
              <div
                key={`${t.name}-${i}`}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate">{t.name}</span>
                <span className="font-mono text-xs">
                  {Math.round(t.practice_score ?? 0).toLocaleString()}
                  {n(t.practice_rank) ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · #{t.practice_rank!.toLocaleString()}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {p.score_contribution != null && (
        <p className="font-mono text-3xs text-muted-foreground">
          Contributes {Math.round(p.score_contribution).toLocaleString()} to this student&apos;s
          Almanac Score.
        </p>
      )}
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
