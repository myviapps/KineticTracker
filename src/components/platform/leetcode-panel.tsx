import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Calendar, Star, Code, Brain } from "lucide-react";

import type { StudentPlatformSummary } from "@/lib/students.functions";
import { Heatmap } from "@/components/heatmap";
import { SectionTitle } from "@/components/stat-card";
import { useCssVars } from "@/hooks/use-css-vars";
import { CHART_MOTION } from "@/lib/chart-motion";
import { cn } from "@/lib/utils";

/**
 * LeetCode.
 *
 * Moved out of students.$roll.tsx VERBATIM — this markup was the whole reason
 * that route was 780 lines, and it is also the only platform panel that was
 * already good. Nothing here changed except where it lives and where its two
 * data inputs come from.
 *
 * It reads `student_stats` rather than `platform_stats` because that is still
 * the live LeetCode store: the submission calendar, language split, tag graph
 * and badges have no columns in platform_stats and live in its `data` blob
 * instead. When 20260808000003's Phase 2 turns student_stats into a view over
 * platform_stats this component keeps working unchanged, which is the point of
 * that migration.
 */

/** The LeetCode-shaped stats row. Loosely typed because student_stats is. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyStats = any;

function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>}
    </div>
  );
}

export function LeetcodePanel({ p, stats }: { p: StudentPlatformSummary; stats: LegacyStats }) {
  const [cBorder, cMutedFg, cPrimary, cSurface2, cEasy, cMedium, cHard] = useCssVars(
    "--border",
    "--muted-foreground",
    "--primary",
    "--surface-2",
    "--easy",
    "--medium",
    "--hard",
  );

  const cal = (stats?.submission_calendar ?? {}) as Record<string, number>;

  // Normalized language stats
  const rawLangs = stats?.language_stats;
  const langs = Array.isArray(rawLangs)
    ? (rawLangs as LegacyStats[])
        .map((l: LegacyStats) => ({
          language: l.languageName ?? l.language ?? "Unknown",
          solved: l.problemsSolved ?? l.solved ?? 0,
        }))
        .sort((a, b) => b.solved - a.solved)
        .slice(0, 6)
    : [];

  // Normalized tag stats
  const rawTags = stats?.tag_stats;
  const tags =
    rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)
      ? {
          fundamental: ((rawTags as LegacyStats).fundamental ?? []).map((t: LegacyStats) => ({
            tag: t.tagName ?? t.tag ?? "Unknown",
            solved: t.problemsSolved ?? t.solved ?? 0,
          })),
          intermediate: ((rawTags as LegacyStats).intermediate ?? []).map((t: LegacyStats) => ({
            tag: t.tagName ?? t.tag ?? "Unknown",
            solved: t.problemsSolved ?? t.solved ?? 0,
          })),
          advanced: ((rawTags as LegacyStats).advanced ?? []).map((t: LegacyStats) => ({
            tag: t.tagName ?? t.tag ?? "Unknown",
            solved: t.problemsSolved ?? t.solved ?? 0,
          })),
        }
      : { fundamental: [], intermediate: [], advanced: [] };

  const [activeDiff, setActiveDiff] = useState<number | null>(null);
  const totalSolved =
    (stats?.easy_solved ?? 0) + (stats?.medium_solved ?? 0) + (stats?.hard_solved ?? 0);
  const difficultyData = [
    { name: "Easy", value: stats?.easy_solved ?? 0, color: cEasy },
    { name: "Medium", value: stats?.medium_solved ?? 0, color: cMedium },
    { name: "Hard", value: stats?.hard_solved ?? 0, color: cHard },
  ];
  const hasDifficulty = difficultyData.some((d) => d.value > 0);
  const center = activeDiff != null ? difficultyData[activeDiff] : null;

  const badges = (stats?.badges ?? []) as {
    id: string;
    name: string;
    icon: string;
    date: string;
  }[];

  // This platform's OWN snapshots and submissions. Both used to come from an
  // unfiltered query that mixed every platform onto one axis.
  const chartData = p.history.map((h) => ({
    date: h.snapshot_date,
    total: h.total_solved,
    day: h.solved_that_day,
  }));
  const recent = p.recent;

  return (
    <>
      {/* Row 3: Heatmap + Difficulty */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* <Heatmap> renders its own card and "Submission Activity" heading — this
            used to wrap it in a second card with the same heading, giving nested
            borders and a duplicated title. */}
        <div className="lg:col-span-2">
          <Heatmap calendar={cal} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <SectionTitle>Difficulty Breakdown</SectionTitle>
          {hasDifficulty ? (
            <div className="mt-2 flex justify-center">
              <div className="relative size-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      {...CHART_MOTION}
                      data={difficultyData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={68}
                      dataKey="value"
                      strokeWidth={0}
                      activeIndex={activeDiff ?? undefined}
                      onMouseEnter={(_, i) => setActiveDiff(i)}
                      onMouseLeave={() => setActiveDiff(null)}
                    >
                      {difficultyData.map((e) => (
                        <Cell key={e.name} fill={e.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-xl font-bold leading-none text-foreground">
                      {center ? center.value : totalSolved}
                    </div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {center ? center.name : "Solved"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-4">
              <DifficultyBar
                label="EASY"
                color="easy"
                solved={stats?.easy_solved ?? 0}
                total={stats?.easy_total ?? 0}
              />
              <DifficultyBar
                label="MEDIUM"
                color="medium"
                solved={stats?.medium_solved ?? 0}
                total={stats?.medium_total ?? 0}
              />
              <DifficultyBar
                label="HARD"
                color="hard"
                solved={stats?.hard_solved ?? 0}
                total={stats?.hard_total ?? 0}
              />
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 font-mono text-xs">
            <div>
              <div className="text-muted-foreground">Acceptance</div>
              <div className="text-base font-bold">{stats?.acceptance_rate ?? "—"}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Reputation</div>
              <div className="text-base font-bold">{stats?.reputation ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: Languages + Skills */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-6">
          <SectionTitle>Languages</SectionTitle>
          {langs.length === 0 ? (
            <EmptyState
              icon={<Code className="size-6" />}
              title="No language data"
              description="Scrape the profile to see language statistics."
            />
          ) : (
            <div className="mt-3 space-y-3">
              {langs.map((l) => {
                const max = Math.max(...langs.map((x) => x.solved));
                return (
                  <div key={l.language}>
                    <div className="mb-1 flex justify-between font-mono text-xs">
                      <span>{l.language}</span>
                      <span className="text-muted-foreground">{l.solved}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(l.solved / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <SectionTitle>Skills by Topic</SectionTitle>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <TagColumn title="Advanced" tags={tags.advanced} color="text-hard" />
            <TagColumn title="Intermediate" tags={tags.intermediate} color="text-medium" />
            <TagColumn title="Fundamental" tags={tags.fundamental} color="text-easy" />
          </div>
          {tags.fundamental.length === 0 &&
            tags.intermediate.length === 0 &&
            tags.advanced.length === 0 && (
              <EmptyState
                icon={<Brain className="size-6" />}
                title="No skill data"
                description="Scrape the profile to see skill breakdown."
              />
            )}
        </div>
      </div>

      {/* Row 5: Solved over time + Badges */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {chartData.length > 1 ? (
            <div className="rounded-lg border border-border bg-surface p-6">
              <SectionTitle>Solved Over Time</SectionTitle>
              <div className="mt-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid stroke={cBorder} strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke={cMutedFg} fontSize={10} />
                    <YAxis stroke={cMutedFg} fontSize={10} />
                    <Tooltip
                      contentStyle={{
                        background: cSurface2,
                        border: `1px solid ${cBorder}`,
                        borderRadius: 6,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: cMutedFg,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke={cPrimary}
                      strokeWidth={2}
                      dot={false}
                      {...CHART_MOTION}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Calendar className="size-6" />}
              title="Not enough history"
              description="At least 2 snapshots needed for a chart."
            />
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <SectionTitle>Badges</SectionTitle>
          {badges.length === 0 ? (
            <EmptyState icon={<Star className="size-6" />} title="No badges earned" />
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs"
                  title={new Date(b.date).toLocaleDateString()}
                >
                  {b.icon && (
                    <img
                      src={b.icon.startsWith("http") ? b.icon : `https://leetcode.com${b.icon}`}
                      alt=""
                      className="size-6"
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  )}
                  <span className="font-semibold">{b.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 6: Recent submissions */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <SectionTitle>Recent Accepted (last 20)</SectionTitle>
        {recent.length === 0 ? (
          <EmptyState
            title="No recent submissions"
            description="Scrape the profile to populate recent submissions."
          />
        ) : (
          <div className="mt-3 max-h-80 space-y-1 overflow-auto">
            {/* Typed now: p.recent is PlatformSubmission[]. It used to come
                from an untyped, unfiltered query that mixed every platform. */}
            {recent.map((r) => (
              <a
                key={r.title_slug + r.submitted_at}
                href={`https://leetcode.com/problems/${r.title_slug}/`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-sm hover:border-border hover:bg-surface-2"
              >
                <span className="truncate">{r.title}</span>
                <span className="ml-3 flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">{r.lang}</span>
                  {new Date(r.submitted_at).toLocaleDateString()}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function DifficultyBar({
  label,
  color,
  solved,
  total,
}: {
  label: string;
  color: "easy" | "medium" | "hard";
  solved: number;
  total: number;
}) {
  const pct = total > 0 ? (solved / total) * 100 : 0;
  const bg = color === "easy" ? "bg-easy" : color === "medium" ? "bg-medium" : "bg-hard";
  const tc = color === "easy" ? "text-easy" : color === "medium" ? "text-medium" : "text-hard";
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[11px] font-bold">
        <span className={tc}>{label}</span>
        <span className="text-muted-foreground">
          <span className="text-foreground">{solved}</span> / {total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full", bg)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function TagColumn({
  title,
  tags,
  color,
}: {
  title: string;
  tags: { tag: string; solved: number }[];
  color: string;
}) {
  const sorted = [...tags].sort((a, b) => b.solved - a.solved).slice(0, 8);
  return (
    <div>
      <h4 className={cn("mb-2 font-mono text-[10px] font-bold uppercase tracking-widest", color)}>
        {title}
      </h4>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {sorted.map((t) => (
            <li key={t.tag} className="flex items-center justify-between font-mono">
              <span>{t.tag}</span>
              <span className="text-muted-foreground">{t.solved}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
