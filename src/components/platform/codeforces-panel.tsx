import type { StudentPlatformSummary } from "@/lib/students.functions";
import {
  IdentityBanner,
  PanelSection,
  TileRow,
  DifficultyBars,
  RatingChart,
  ContestTable,
  SolvedOverTime,
  toRatingHistory,
  blob,
  str,
  num,
  fmt,
  type Tile,
} from "@/components/platform/panel-kit";

/**
 * Codeforces.
 *
 * Leads with the RANK TITLE, not the number. "Expert" is how Codeforces
 * describes standing and how competitors describe themselves; the adapter has
 * stored `cf_rank_title` since day one and nothing rendered it. A bare 1687 is
 * meaningless to anyone who does not already know the tiers.
 *
 * Difficulty here is derived from the problemset ratings, not published as
 * easy/medium/hard — see the adapter's `bucketOf`. It is still worth showing,
 * but it means something different from LeetCode's split and the caption says so.
 */

/**
 * Official Codeforces tier colours, so the title reads the way it does on the
 * site. Matching on the title rather than the number because the adapter stores
 * the title and the cut points are Codeforces' to change, not ours.
 */
function tierTone(title: string | null): string {
  if (!title) return "text-foreground";
  const t = title.toLowerCase();
  if (t.includes("legendary")) return "text-hard";
  if (t.includes("grandmaster")) return "text-hard";
  if (t.includes("master")) return "text-medium";
  if (t.includes("candidate")) return "text-[color:var(--primary)]";
  if (t.includes("expert")) return "text-primary";
  if (t.includes("specialist")) return "text-easy";
  if (t.includes("pupil")) return "text-easy";
  return "text-muted-foreground";
}

export function CodeforcesPanel({ p }: { p: StudentPlatformSummary }) {
  const s = p.stats;
  const d = blob(p);

  const title = str(d.cf_rank_title);
  const maxTitle = str(d.cf_max_rank_title);
  const org = str(d.organization);
  const city = str(d.city);
  const registered = str(d.registered_at);
  const contribution = num(d.contribution);

  const history = toRatingHistory(d.rating_history);
  const solved = num(s?.total_solved) ?? 0;

  const tiles: Tile[] = [
    {
      label: "Rating",
      value: fmt(s?.rating),
      hint: s?.max_rating ? `peak ${fmt(s.max_rating)}` : undefined,
    },
    { label: "Solved", value: fmt(s?.total_solved), hint: "derived from submissions" },
    { label: "Contests", value: fmt(s?.contests_attended), hint: "rated" },
  ];
  if (contribution !== null) {
    tiles.push({ label: "Contribution", value: fmt(contribution), hint: "community" });
  }

  return (
    <div className="space-y-6">
      <IdentityBanner
        p={p}
        headline={title ? title.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined}
        tone={tierTone(title)}
        sub={
          <span className="flex flex-wrap gap-x-3">
            {maxTitle && maxTitle !== title && <span>peak {maxTitle}</span>}
            {org && <span>{org}</span>}
            {city && <span>{city}</span>}
            {registered && <span>since {new Date(registered).getFullYear()}</span>}
          </span>
        }
      />

      <TileRow tiles={tiles} />

      <PanelSection
        title="Rating over time"
        platformId={p.platform_id}
        platformName={p.name}
        capability="rating"
        hasData={history.length > 1}
        right={
          <span className="font-mono text-[10px] text-muted-foreground">
            {history.length} rated contests
          </span>
        }
      >
        <RatingChart history={history} />
      </PanelSection>

      <PanelSection
        title="Contest history"
        platformId={p.platform_id}
        platformName={p.name}
        capability="contests"
        hasData={history.length > 0}
      >
        <ContestTable history={history} />
      </PanelSection>

      <PanelSection
        title="Difficulty breakdown"
        platformId={p.platform_id}
        platformName={p.name}
        capability="difficulty"
        hasData={solved > 0}
        right={
          <span className="font-mono text-[10px] text-muted-foreground">
            bucketed by problem rating
          </span>
        }
      >
        <DifficultyBars
          easy={s?.easy_solved}
          medium={s?.medium_solved}
          hard={s?.hard_solved}
          unrated={s?.unrated_solved}
          total={solved}
        />
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
