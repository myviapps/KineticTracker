import type { StudentPlatformSummary } from "@/lib/students.functions";
import { Heatmap } from "@/components/heatmap";
import {
  IdentityBanner,
  PanelSection,
  TileRow,
  DifficultyBars,
  SolvedOverTime,
  toCalendarMap,
  blob,
  str,
  num,
  fmt,
  type Tile,
} from "@/components/platform/panel-kit";

/**
 * GeeksforGeeks — the platform that was losing the most.
 *
 * The adapter stores heat_map, line_chart, languages, badges, contests,
 * longest_streak, institute_name, monthly_score and the School/Basic tier counts.
 * The generic panel rendered none of it: four numbers and a bar chart, from a
 * response that carries a year of activity and a language breakdown.
 *
 * The School/Basic tiers matter enough to show separately. GFG's own weights in
 * the platforms seed are deliberately low — "School/Basic tiers inflate raw
 * counts" — so a headline solved count here is not comparable to a LeetCode one,
 * and showing the tiers is what makes that visible rather than hidden in a
 * scoring constant.
 */

type Badge = { name?: string | null; level?: string | null; description?: string | null };
type Language = { name?: string | null; count?: number | null; language?: string | null };

export function GeeksforgeeksPanel({ p }: { p: StudentPlatformSummary }) {
  const s = p.stats;
  const d = blob(p);

  const institute = str(d.institute_name);
  const monthlyScore = num(d.monthly_score);
  const longestStreak = num(d.longest_streak);
  const school = num(d.school_solved);
  const basic = num(d.basic_solved);
  const created = str(d.created_date);

  const calendar = toCalendarMap(d.heat_map);
  const heatmapDays = Object.keys(calendar).length;

  const languages = (Array.isArray(d.languages) ? (d.languages as Language[]) : [])
    .map((l) => ({
      name: str(l.name) ?? str(l.language) ?? "Unknown",
      count: num(l.count) ?? 0,
    }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const badges = (Array.isArray(d.badges) ? (d.badges as Badge[]) : []).filter((b) => str(b.name));
  const contests = Array.isArray(d.contests) ? (d.contests as unknown[]) : [];

  const solved = num(s?.total_solved) ?? 0;

  const tiles: Tile[] = [
    { label: "Coding Score", value: fmt(s?.platform_score), hint: "GfG score" },
    { label: "Solved", value: fmt(s?.total_solved) },
    {
      label: "Institute Rank",
      value: s?.institute_rank ? `#${fmt(s.institute_rank)}` : "—",
      hint: institute ?? undefined,
    },
    {
      label: "Streak",
      value: s?.streak ? `${s.streak}d` : "—",
      hint: longestStreak ? `best ${longestStreak}d` : undefined,
    },
  ];
  if (monthlyScore !== null) {
    tiles.push({ label: "Monthly Score", value: fmt(monthlyScore), hint: "this month" });
  }

  return (
    <div className="space-y-6">
      <IdentityBanner
        p={p}
        headline={s?.platform_score ? fmt(s.platform_score) : undefined}
        sub={
          <span className="flex flex-wrap gap-x-3">
            {institute && <span>{institute}</span>}
            {created && <span>since {new Date(created).getFullYear()}</span>}
          </span>
        }
      />

      <TileRow tiles={tiles} />

      {/* The component is generic over CalendarMap; GFG's date-keyed heatmap is
          converted by toCalendarMap. Only LeetCode was ever wired to it. */}
      <PanelSection
        title="Submission activity"
        platformId={p.platform_id}
        platformName={p.name}
        capability="heatmap"
        hasData={heatmapDays > 0}
      >
        <Heatmap calendar={calendar} />
      </PanelSection>

      <PanelSection
        title="Difficulty breakdown"
        platformId={p.platform_id}
        platformName={p.name}
        capability="difficulty"
        hasData={solved > 0}
      >
        <DifficultyBars
          easy={s?.easy_solved}
          medium={s?.medium_solved}
          hard={s?.hard_solved}
          unrated={s?.unrated_solved}
          total={solved}
        />
        {(school !== null || basic !== null) && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 font-mono text-3xs uppercase tracking-widest text-muted-foreground">
              Entry tiers
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              {school !== null && (
                <span>
                  School <b className="font-mono">{school.toLocaleString()}</b>
                </span>
              )}
              {basic !== null && (
                <span>
                  Basic <b className="font-mono">{basic.toLocaleString()}</b>
                </span>
              )}
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">
              Counted separately because these tiers inflate a raw total — the Almanac Score weights
              them low for the same reason.
            </p>
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Languages"
        platformId={p.platform_id}
        platformName={p.name}
        capability="languages"
        hasData={languages.length > 0}
      >
        <div className="space-y-2">
          {languages.map((l) => {
            const top = languages[0].count || 1;
            return (
              <div key={l.name}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="truncate">{l.name}</span>
                  <span className="font-mono font-bold">{l.count.toLocaleString()}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((l.count / top) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection
        title="Badges"
        platformId={p.platform_id}
        platformName={p.name}
        capability="badges"
        hasData={badges.length > 0}
      >
        <div className="flex flex-wrap gap-2">
          {badges.map((b, i) => (
            <span
              key={`${b.name}-${i}`}
              className="rounded-md border border-border px-2 py-1 text-xs"
              title={str(b.description) ?? undefined}
            >
              {b.name}
              {b.level && <span className="ml-1 text-muted-foreground">· {b.level}</span>}
            </span>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title="Contests"
        platformId={p.platform_id}
        platformName={p.name}
        capability="contests"
        hasData={contests.length > 0}
      >
        <p className="font-mono text-sm">
          {contests.length} contest{contests.length === 1 ? "" : "s"} recorded
        </p>
      </PanelSection>

      <PanelSection
        title="Solved over time"
        platformId={p.platform_id}
        platformName={p.name}
        hasData={p.history.length > 1}
      >
        <SolvedOverTime history={p.history} />
      </PanelSection>

      {p.score_contribution != null && (
        <p className="font-mono text-3xs text-muted-foreground">
          Contributes {Math.round(p.score_contribution).toLocaleString()} to this student&apos;s
          Almanac Score.
        </p>
      )}
    </div>
  );
}
