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
  str,
  num,
  fmt,
  type Tile,
} from "@/components/platform/panel-kit";

/**
 * CodeChef.
 *
 * Leads with STARS and DIVISION, which is how CodeChef itself labels a user and
 * how competitors introduce themselves — "5★, Div 2" says more than "1834" to
 * anyone inside that community. The adapter has stored `division` all along and
 * nothing rendered it.
 *
 * ── This panel is the template for AtCoder ────────────────────────────────
 * AtCoder is the same shape: a ladder rating, a rating history with contest
 * names and ranks, a solved count, and no difficulty split (its seed notes say
 * the split needs a 4.4MB problem dump). When that adapter lands, copy this file
 * and swap the stars/division block for AtCoder's colour band. Kept deliberately
 * plain for that reason — nothing here is cleverer than it needs to be.
 */

function Stars({ n }: { n: number }) {
  return (
    <span className="text-medium" title={`${n} star${n === 1 ? "" : "s"}`}>
      {"★".repeat(Math.min(n, 7))}
    </span>
  );
}

export function CodechefPanel({ p }: { p: StudentPlatformSummary }) {
  const s = p.stats;
  const d = blob(p);

  const division = str(d.division);
  const institution = str(d.institution);
  const stars = num(s?.stars);
  const history = toRatingHistory(d.rating_history);

  const tiles: Tile[] = [
    {
      label: "Rating",
      value: fmt(s?.rating),
      hint: s?.max_rating ? `peak ${fmt(s.max_rating)}` : undefined,
    },
    { label: "Solved", value: fmt(s?.total_solved) },
    { label: "Global Rank", value: s?.global_rank ? `#${fmt(s.global_rank)}` : "—" },
    { label: "Country Rank", value: s?.country_rank ? `#${fmt(s.country_rank)}` : "—" },
  ];
  if (s?.contests_attended !== null && s?.contests_attended !== undefined) {
    tiles.push({ label: "Contests", value: fmt(s.contests_attended), hint: "rated" });
  }

  return (
    <div className="space-y-6">
      <IdentityBanner
        p={p}
        headline={
          stars !== null || division ? (
            <span className="inline-flex items-baseline gap-2">
              {stars !== null && <Stars n={stars} />}
              {division && <span className="text-primary">Div {division}</span>}
            </span>
          ) : undefined
        }
        sub={institution ? <span>{institution}</span> : undefined}
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
        No difficulty section. CodeChef publishes no split — the whole count
        lands in unrated_solved — so PanelSection would render "CodeChef does not
        publish difficulty breakdown", which is true but not worth a card on
        every load. The capability map still records it for anything that asks.
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
