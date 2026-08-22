import type { StudentPlatformSummary } from "@/lib/students.functions";
import {
  IdentityBanner,
  PanelSection,
  TileRow,
  RatingChart,
  ContestTable,
  SolvedOverTime,
  toRatingHistory,
  blob,
  num,
  fmt,
  type Tile,
} from "@/components/platform/panel-kit";

/**
 * AtCoder.
 *
 * Copied from the CodeChef panel, which was written to be copied: both are
 * ladder-rating platforms with a contest history carrying names and ranks, a
 * solved count, and no difficulty split. The only real difference is what the
 * community reads as identity — CodeChef says stars and division, AtCoder says
 * a colour band.
 *
 * The bands are AtCoder's own and everyone there thinks in them: a "Cyan" coder
 * is a specific, recognised thing in a way that "1247" is not. Cut points come
 * from AtCoder's published scheme, not from us, which is why they are stated
 * once here rather than derived.
 */

const BANDS: { min: number; name: string; tone: string }[] = [
  { min: 2800, name: "Red", tone: "text-hard" },
  { min: 2400, name: "Orange", tone: "text-hard" },
  { min: 2000, name: "Yellow", tone: "text-medium" },
  { min: 1600, name: "Blue", tone: "text-primary" },
  { min: 1200, name: "Cyan", tone: "text-easy" },
  { min: 800, name: "Green", tone: "text-easy" },
  { min: 400, name: "Brown", tone: "text-medium" },
  { min: 0, name: "Grey", tone: "text-muted-foreground" },
];

function bandFor(rating: number | null): { name: string; tone: string } | null {
  if (rating === null) return null;
  return BANDS.find((b) => rating >= b.min) ?? BANDS[BANDS.length - 1];
}

export function AtcoderPanel({ p }: { p: StudentPlatformSummary }) {
  const s = p.stats;
  const d = blob(p);

  const history = toRatingHistory(d.rating_history);
  const band = bandFor(num(s?.rating));
  const peakBand = bandFor(num(s?.max_rating));

  const tiles: Tile[] = [
    {
      label: "Rating",
      value: fmt(s?.rating),
      hint: s?.max_rating ? `peak ${fmt(s.max_rating)}` : undefined,
    },
    { label: "Solved", value: fmt(s?.total_solved), hint: "accepted problems" },
    { label: "Global Rank", value: s?.global_rank ? `#${fmt(s.global_rank)}` : "—" },
  ];
  if (s?.contests_attended !== null && s?.contests_attended !== undefined) {
    tiles.push({ label: "Contests", value: fmt(s.contests_attended), hint: "rated" });
  }

  return (
    <div className="space-y-6">
      <IdentityBanner
        p={p}
        headline={band?.name}
        tone={band?.tone}
        sub={
          peakBand && peakBand.name !== band?.name ? <span>peak {peakBand.name}</span> : undefined
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
          <span className="font-mono text-3xs text-muted-foreground">
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

      {/*
        No difficulty section: AtCoder publishes no split without the 4.4MB
        problem-metadata dump, so the adapter leaves those fields undefined and
        a card here would say "does not publish" on every single load.
      */}

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
