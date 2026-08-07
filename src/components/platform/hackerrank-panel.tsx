import type { StudentPlatformSummary } from "@/lib/students.functions";
import {
  IdentityBanner,
  PanelSection,
  TileRow,
  SolvedOverTime,
  blob,
  str,
  num,
  fmt,
  type Tile,
} from "@/components/platform/panel-kit";

/**
 * HackerRank.
 *
 * Badges ARE the platform here. Per the seed notes, total_solved is a SUM of the
 * badges endpoint — "the profile model has no solved_challenges field" — so the
 * badge list is not decoration, it is where the headline number comes from.
 * Showing the total without the badges hides its own derivation.
 *
 * No difficulty split, which is why the platforms seed gives it `weight_unrated`.
 * The panel does not render a difficulty card at all rather than showing one that
 * says "not published" on every single load.
 */

type Badge = {
  name?: string | null;
  stars?: number | null;
  solved?: number | null;
  total?: number | null;
  rank?: number | null;
};
type Track = {
  name?: string | null;
  practice_score?: number | null;
  practice_rank?: number | null;
  contest_score?: number | null;
};

export function HackerrankPanel({ p }: { p: StudentPlatformSummary }) {
  const s = p.stats;
  const d = blob(p);

  const level = str(d.level);
  const school = str(d.school);
  const company = str(d.company);
  const jobTitle = str(d.job_title);
  const followers = num(d.followers_count);

  const badges = (Array.isArray(d.badges) ? (d.badges as Badge[]) : [])
    .filter((b) => num(b.solved))
    .sort((a, b) => (num(b.stars) ?? 0) - (num(a.stars) ?? 0));

  const tracks = (Array.isArray(d.tracks) ? (d.tracks as Track[]) : [])
    .filter((t) => num(t.practice_score) || num(t.contest_score))
    .sort((a, b) => (num(b.practice_score) ?? 0) - (num(a.practice_score) ?? 0));

  const tiles: Tile[] = [
    { label: "Score", value: fmt(s?.platform_score), hint: "elo" },
    { label: "Solved", value: fmt(s?.total_solved), hint: "summed across badges" },
    { label: "Stars", value: s?.stars ? `${s.stars}★` : "—" },
    {
      label: "Global Rank",
      value: s?.global_rank ? `#${fmt(s.global_rank)}` : "—",
      hint: "best track",
    },
  ];
  if (followers !== null) {
    tiles.push({ label: "Followers", value: fmt(followers) });
  }

  return (
    <div className="space-y-6">
      <IdentityBanner
        p={p}
        headline={level ?? undefined}
        sub={
          <span className="flex flex-wrap gap-x-3">
            {jobTitle && <span>{jobTitle}</span>}
            {company && <span>{company}</span>}
            {school && <span>{school}</span>}
          </span>
        }
      />

      <TileRow tiles={tiles} />

      <PanelSection
        title="Badges"
        platformId={p.platform_id}
        platformName={p.name}
        capability="badges"
        hasData={badges.length > 0}
        right={
          <span className="font-mono text-[10px] text-muted-foreground">
            solved total is the sum of these
          </span>
        }
      >
        <div className="space-y-2">
          {badges.map((b, i) => (
            <div key={`${b.name}-${i}`} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate">{b.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {b.solved}
                {b.total ? `/${b.total}` : ""}
              </span>
              {num(b.stars) ? (
                <span className="font-mono text-xs text-medium">
                  {"★".repeat(Math.min(b.stars!, 6))}
                </span>
              ) : null}
              {num(b.rank) ? (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  rank #{b.rank!.toLocaleString()}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title="Scores by track"
        platformId={p.platform_id}
        platformName={p.name}
        hasData={tracks.length > 0}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {tracks.slice(0, 16).map((t, i) => (
            <div
              key={`${t.name}-${i}`}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="truncate">{t.name}</span>
              <span className="font-mono text-xs">
                {Math.round(t.practice_score ?? 0).toLocaleString()}
                {num(t.practice_rank) ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · #{t.practice_rank!.toLocaleString()}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
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
        <p className="font-mono text-[10px] text-muted-foreground">
          Contributes {Math.round(p.score_contribution).toLocaleString()} to this student&apos;s
          Almanac Score.
        </p>
      )}
    </div>
  );
}
