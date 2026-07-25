import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, RefreshCw, MapPin, Flame, Trophy, Calendar, Star, Code, Brain } from "lucide-react";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { getStudentByRoll, refreshStudent, deleteStudent } from "@/lib/students.functions";
import { useCssVars } from "@/hooks/use-css-vars";
import { Button } from "@/components/ui/button";
import { Heatmap } from "@/components/heatmap";
import { StatCard, SectionTitle } from "@/components/stat-card";
import {
  todayCount, thisWeekCount, thisMonthCount, thisYearCount,
} from "@/lib/date-buckets";
import { cn } from "@/lib/utils";

const studentQO = (roll: string) =>
  queryOptions({
    queryKey: ["student", roll],
    queryFn: () => getStudentByRoll({ data: { roll } }),
  });

function PendingStudent() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 h-32 animate-pulse rounded-lg border border-border bg-surface p-6" />
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
         {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </div>
      <div className="h-[400px] animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}

export const Route = createFileRoute("/students/$roll")({
  head: () => ({ meta: [{ title: "Student — Kinetic" }] }),
  loader: ({ params, context }) => {
    if (typeof window !== "undefined") {
      return context.queryClient.ensureQueryData(studentQO(params.roll));
    }
  },
  component: StudentPage,
  pendingComponent: PendingStudent,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8 text-sm">Student not found.</div>,
});

function EmptyState({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center">
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>}
    </div>
  );
}

function StudentPage() {
  const { roll } = Route.useParams();
  const { data } = useSuspenseQuery(studentQO(roll));
  const { student, stats, recent, history, classroom } = data;
  const router = useRouter();

  const refresh = useServerFn(refreshStudent);
  const refreshM = useMutation({
    mutationFn: () => refresh({ data: { id: student.id } }),
    onSuccess: () => { toast.success("Refreshed"); router.invalidate(); },
    onError: (e) => toast.error(String(e)),
  });

  const [cBorder, cMutedFg, cPrimary, cSurface2, cEasy, cMedium, cHard] = useCssVars(
    "--border", "--muted-foreground", "--primary", "--surface-2", "--easy", "--medium", "--hard",
  );

  const cal = (stats?.submission_calendar ?? {}) as Record<string, number>;
  const today = todayCount(cal);
  const week = thisWeekCount(cal);
  const month = thisMonthCount(cal);
  const year = thisYearCount(cal);

  // Normalized language stats
  const rawLangs = stats?.language_stats;
  const langs = Array.isArray(rawLangs)
    ? (rawLangs as any[]).map((l: any) => ({
        language: l.languageName ?? l.language ?? "Unknown",
        solved: l.problemsSolved ?? l.solved ?? 0,
      })).sort((a, b) => b.solved - a.solved).slice(0, 6)
    : [];

  // Normalized tag stats
  const rawTags = stats?.tag_stats;
  const tags = rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)
    ? {
        fundamental: ((rawTags as any).fundamental ?? []).map((t: any) => ({
          tag: t.tagName ?? t.tag ?? "Unknown",
          solved: t.problemsSolved ?? t.solved ?? 0,
        })),
        intermediate: ((rawTags as any).intermediate ?? []).map((t: any) => ({
          tag: t.tagName ?? t.tag ?? "Unknown",
          solved: t.problemsSolved ?? t.solved ?? 0,
        })),
        advanced: ((rawTags as any).advanced ?? []).map((t: any) => ({
          tag: t.tagName ?? t.tag ?? "Unknown",
          solved: t.problemsSolved ?? t.solved ?? 0,
        })),
      }
    : { fundamental: [], intermediate: [], advanced: [] };

  const [activeDiff, setActiveDiff] = useState<number | null>(null);
  const totalSolved = (stats?.easy_solved ?? 0) + (stats?.medium_solved ?? 0) + (stats?.hard_solved ?? 0);
  const difficultyData = [
    { name: "Easy", value: stats?.easy_solved ?? 0, color: cEasy },
    { name: "Medium", value: stats?.medium_solved ?? 0, color: cMedium },
    { name: "Hard", value: stats?.hard_solved ?? 0, color: cHard },
  ];
  const hasDifficulty = difficultyData.some(d => d.value > 0);
  const center = activeDiff != null ? difficultyData[activeDiff] : null;

  const badges = (stats?.badges ?? []) as { id: string; name: string; icon: string; date: string }[];

  const chartData = history.map((h: any) => ({
    date: h.snapshot_date,
    total: h.total_solved,
    day: h.solved_that_day,
  }));

  const err = student.scrape_error;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <button
        onClick={() => router.history.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>
      {/* Row 1: Sticky header card */}
      <div className="mb-6 rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start gap-6">
          {stats?.avatar ? (
            <img
              src={stats.avatar}
              alt=""
              className="size-20 rounded-lg bg-muted object-cover ring-1 ring-white/10"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : (
            <div className="grid size-20 place-items-center rounded-lg bg-muted font-mono text-2xl font-bold">
              {student.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
              <span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary">
                {student.roll}
              </span>
              {classroom && (
                <span className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-accent-foreground">
                  {classroom.name}
                </span>
              )}
              {stats?.contest_top_percentage != null && stats.contest_top_percentage < 5 && (
                <span className="rounded bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-primary ring-1 ring-primary/30">
                  ELITE
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <a
                href={`https://leetcode.com/u/${student.leetcode_id}/`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                @{student.leetcode_id} <ExternalLink className="size-3" />
              </a>
              {stats?.real_name && <span>· {stats.real_name}</span>}
              {stats?.country && (
                <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{stats.country}</span>
              )}
            </div>
            {student.last_scraped_at && (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Last scraped {new Date(student.last_scraped_at).toLocaleString()}
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => refreshM.mutate()} disabled={refreshM.isPending}>
            <RefreshCw className={cn("mr-1 size-4", refreshM.isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {err && (
        <div className="mb-6 rounded-lg border border-hard/40 bg-hard/10 p-4 text-sm">
          <strong className="text-hard">Scrape error:</strong> {err}
        </div>
      )}

      {/* Row 2: KPI tiles - 2x2 mobile, 4x1 lg */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Solved" value={stats?.total_solved ?? 0} hint={`of ${stats?.total_questions ?? 0}`} />
        <StatCard
          label="Global Rank"
          value={stats?.ranking ? <span className="inline-flex items-center gap-1"><Trophy className="size-5 text-primary" />#{stats.ranking.toLocaleString()}</span> : "—"}
        />
        <StatCard
          label="Streak"
          value={<span className="inline-flex items-center gap-1"><Flame className="size-5 text-primary" />{stats?.streak ?? 0}d</span>}
          hint={`${stats?.total_active_days ?? 0} active days`}
        />
        <StatCard
          label="Contest Rating"
          value={stats?.contest_rating ? Math.round(stats.contest_rating).toLocaleString() : "—"}
          hint={stats?.contests_attended ? `${stats.contests_attended} contests` : undefined}
        />
      </div>

      {/* Row 3: Heatmap + Difficulty */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-border bg-surface p-6">
            <SectionTitle>Submission Activity</SectionTitle>
            <Heatmap calendar={cal} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <SectionTitle>Difficulty Breakdown</SectionTitle>
          {hasDifficulty ? (
            <div className="mt-2 flex justify-center">
              <div className="relative size-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={difficultyData}
                      cx="50%" cy="50%"
                      innerRadius={48} outerRadius={68}
                      dataKey="value"
                      strokeWidth={0}
                      activeIndex={activeDiff ?? undefined}
                      onMouseEnter={(_, i) => setActiveDiff(i)}
                      onMouseLeave={() => setActiveDiff(null)}
                    >
                      {difficultyData.map((e) => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<DiffTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-xl font-bold leading-none">{center ? center.value : totalSolved}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {center ? center.name : "Solved"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-4">
              <DifficultyBar label="EASY" color="easy" solved={stats?.easy_solved ?? 0} total={stats?.easy_total ?? 0} />
              <DifficultyBar label="MEDIUM" color="medium" solved={stats?.medium_solved ?? 0} total={stats?.medium_total ?? 0} />
              <DifficultyBar label="HARD" color="hard" solved={stats?.hard_solved ?? 0} total={stats?.hard_total ?? 0} />
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
            <EmptyState icon={<Code className="size-6" />} title="No language data" description="Scrape the profile to see language statistics." />
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
                      <div className="h-full bg-primary" style={{ width: `${(l.solved / max) * 100}%` }} />
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
          {tags.fundamental.length === 0 && tags.intermediate.length === 0 && tags.advanced.length === 0 && (
            <EmptyState icon={<Brain className="size-6" />} title="No skill data" description="Scrape the profile to see skill breakdown." />
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
                    <Line type="monotone" dataKey="total" stroke={cPrimary} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <EmptyState icon={<Calendar className="size-6" />} title="Not enough history" description="At least 2 snapshots needed for a chart." />
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
                  {b.icon && <img src={b.icon.startsWith("http") ? b.icon : `https://leetcode.com${b.icon}`} alt="" className="size-6" onError={(e) => (e.currentTarget.style.display = "none")} />}
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
          <EmptyState title="No recent submissions" description="Scrape the profile to populate recent submissions." />
        ) : (
          <div className="mt-3 max-h-80 space-y-1 overflow-auto">
            {recent.map((r: any) => (
              <a
                key={r.title_slug + r.submitted_at}
                href={`https://leetcode.com/problems/${r.title_slug}/`}
                target="_blank" rel="noreferrer"
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
    </div>
  );
}

function DifficultyBar({
  label, color, solved, total,
}: { label: string; color: "easy" | "medium" | "hard"; solved: number; total: number }) {
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

function DiffTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-1.5 font-semibold">
        <span className="size-2.5 rounded-full" style={{ background: e.payload.fill }} />
        {e.payload.name}
      </div>
      <div className="mt-0.5 font-mono text-muted-foreground">
        {e.value} solved
      </div>
    </div>
  );
}

function TagColumn({ title, tags, color }: { title: string; tags: { tag: string; solved: number }[]; color: string }) {
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
