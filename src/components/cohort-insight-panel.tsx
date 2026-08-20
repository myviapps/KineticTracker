import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

import { useCssVars } from "@/hooks/use-css-vars";
import { LeaderboardBars } from "@/components/leaderboard-bars";
import { TopNControl } from "@/components/top-n-control";
import { TrendWindowControl } from "@/components/trend-window-control";
import { cn } from "@/lib/utils";

/**
 * Zone 2: one panel, three tabs.
 *
 * Trend, Distribution and Leaderboard used to be three stacked sections — the
 * leaderboard alone was a 520px block you had to scroll past to reach the
 * roster. They answer three different questions and you are only ever asking
 * one, so they share a slot instead of queueing for attention. Nothing is lost;
 * everything is one click away.
 */

export type TrendPoint = { day: string; solved: number };
export type BandPoint = { label: string; count: number };
export type BoardEntry = { id: string; name: string; roll: string; total: number };

export type Tab = "trend" | "distribution" | "leaderboard";

const TABS: Tab[] = ["trend", "distribution", "leaderboard"];

/** Read a panel tab out of a search param; anything unknown falls back. */
export function parseInsightTab(v: unknown, fallback: Tab = "trend"): Tab {
  return TABS.includes(v as Tab) ? (v as Tab) : fallback;
}

export function CohortInsightPanel({
  title,
  trend,
  trendEmptyNote,
  trendWindowDays = 30,
  onTrendWindowDays,
  difficulty,
  bands,
  board,
  boardMax,
  topN,
  onTopN,
  tab: controlledTab,
  onTab,
  animate = true,
}: {
  /** What the lens is called, for the panel heading. */
  title: string;
  trend: TrendPoint[];
  /** Shown instead of the chart when there is no history — never a flat zero. */
  trendEmptyNote?: string;
  /** The window the series was QUERIED over, which is not the same as what it covers. */
  trendWindowDays?: number;
  /** Omit to render the window as fixed — the control only appears when it can act. */
  onTrendWindowDays?: (days: number) => void;
  /** Easy/Medium/Hard, or null when the platform publishes no split. */
  difficulty?: { easy: number; medium: number; hard: number } | null;
  bands: BandPoint[];
  board: BoardEntry[];
  boardMax: number;
  topN: number;
  onTopN: (n: number) => void;
  /**
   * Controlled tab. Supply both to keep the open tab in the URL — a link to a
   * leaderboard with `topN` set is useless if it opens on the trend chart.
   * Omit both and the panel keeps its own state, as before.
   */
  tab?: Tab;
  onTab?: (t: Tab) => void;
  animate?: boolean;
}) {
  const [ownTab, setOwnTab] = useState<Tab>("trend");
  const tab = controlledTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const [activeSlice, setActiveSlice] = useState<number | null>(null);

  const [cEasy, cMedium, cHard, cSurface, cBorder, cMutedFg, cPrimary] = useCssVars(
    "--easy",
    "--medium",
    "--hard",
    "--surface",
    "--border",
    "--muted-foreground",
    "--primary",
  );

  const motion = animate ? {} : { isAnimationActive: false };
  const tooltipStyle = {
    background: cSurface,
    border: `1px solid ${cBorder}`,
    fontSize: 12,
    color: cMutedFg,
  };

  const diff = difficulty
    ? [
        { name: "Easy", value: difficulty.easy, color: cEasy },
        { name: "Medium", value: difficulty.medium, color: cMedium },
        { name: "Hard", value: difficulty.hard, color: cHard },
      ]
    : null;
  const diffTotal = diff ? diff.reduce((a, d) => a + d.value, 0) : 0;
  const center = activeSlice != null && diff ? diff[activeSlice] : null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "trend", label: "Trend" },
    { id: "distribution", label: diff ? "Difficulty" : "Distribution" },
    { id: "leaderboard", label: "Leaderboard" },
  ];

  return (
    <div className="mb-6 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          {tab === "leaderboard" && <TopNControl value={topN} max={boardMax} onChange={onTopN} />}
          {tab === "trend" && onTrendWindowDays && (
            <TrendWindowControl value={trendWindowDays} onChange={onTrendWindowDays} />
          )}
        </div>
      </div>

      <div className="p-4">
        {tab === "trend" &&
          (trend.length === 0 ? (
            <Empty
              note={trendEmptyNote ?? "starts after the first refresh"}
              title="No history yet"
            />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={trend}>
                    <CartesianGrid stroke={cBorder} strokeDasharray="3 3" />
                    <XAxis dataKey="day" fontSize={10} stroke={cMutedFg} />
                    <YAxis fontSize={10} stroke={cMutedFg} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line
                      type="monotone"
                      dataKey="solved"
                      stroke={cPrimary}
                      strokeWidth={2}
                      dot={false}
                      {...motion}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/*
                "Totals per snapshot date", never "per day". solved_that_day
                differences against the most recent EARLIER snapshot, so a
                platform refreshed weekly lands seven days of gain on one date.

                The caption counts the dates actually PLOTTED rather than
                asserting the window. It read "last 30 days" unconditionally,
                which is how a truncated five-point series went unnoticed — the
                label vouched for coverage the chart never had. A cohort three
                days into collecting now says so, and so does a query that came
                back short.
              */}
              <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                solved per snapshot date · {trend.length}/{trendWindowDays} days with data
              </p>
            </>
          ))}

        {tab === "distribution" &&
          (diff && diffTotal > 0 ? (
            <>
              <div className="relative h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      {...motion}
                      data={diff}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={2}
                      strokeWidth={0}
                      activeIndex={activeSlice ?? undefined}
                      onMouseEnter={(_, i) => setActiveSlice(i)}
                      onMouseLeave={() => setActiveSlice(null)}
                    >
                      {diff.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold leading-none text-foreground">
                      {(center ? center.value : diffTotal).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {center ? center.name : "Solved"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
                <div>
                  <span className="text-easy">■</span> Easy {diff[0].value.toLocaleString()}
                </div>
                <div>
                  <span className="text-medium">■</span> Med {diff[1].value.toLocaleString()}
                </div>
                <div>
                  <span className="text-hard">■</span> Hard {diff[2].value.toLocaleString()}
                </div>
              </div>
            </>
          ) : bands.length === 0 ? (
            <Empty title="Nothing to distribute" note="no students on this platform yet" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={bands}>
                  <CartesianGrid stroke={cBorder} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={9} stroke={cMutedFg} interval={0} />
                  <YAxis fontSize={10} stroke={cMutedFg} allowDecimals={false} />
                  <Tooltip cursor={{ fill: cBorder, opacity: 0.3 }} contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={cPrimary} radius={[3, 3, 0, 0]} {...motion} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}

        {tab === "leaderboard" &&
          (board.length === 0 ? (
            <Empty title="No ranked students" note="nobody has data on this platform yet" />
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1">
              <LeaderboardBars entries={board} />
            </div>
          ))}
      </div>
    </div>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {note}
      </p>
    </div>
  );
}
