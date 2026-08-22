import { ExternalLink, AlertTriangle } from "lucide-react";
import type { StudentPlatformSummary } from "@/lib/students.functions";

/**
 * One card per platform the student has an account on.
 *
 * This is the direct answer to "what is this student doing on each platform, and
 * where do they stand" — visible without a click, because that question is the
 * reason someone opens this page at all.
 *
 * Each card leads with the metric that platform is actually ranked on. Showing
 * problems-solved for Codeforces would be actively misleading: a 1900-rated
 * competitor with 300 solves is stronger than a 900-rated one with 900, so the
 * platform's own `rank_metric` decides what goes in the big number.
 */

/** Which number this platform leads with, and how to render it. */
function headline(p: StudentPlatformSummary): { value: string; label: string } {
  const s = p.stats;
  if (!s) return { value: "—", label: "not fetched yet" };

  switch (p.rank_metric) {
    case "rating":
      return s.rating != null
        ? {
            value: String(Math.round(s.rating)),
            label: s.max_rating ? `max ${Math.round(s.max_rating)}` : "rating",
          }
        : { value: "—", label: "unrated" };
    case "score":
      return s.platform_score != null
        ? { value: compact(s.platform_score), label: "score" }
        : { value: s.total_solved != null ? String(s.total_solved) : "—", label: "solved" };
    default:
      return s.total_solved != null
        ? { value: String(s.total_solved), label: "solved" }
        : { value: "—", label: "no data" };
  }
}

function compact(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Freshness, as a colour.
 *
 * 'partial' is its own state rather than being folded into success: it means the
 * fetch was cut short and will resume, which is materially different from
 * "finished, and this is all there is".
 */
function freshness(p: StudentPlatformSummary): { cls: string; title: string } {
  if (p.status === "invalid_handle")
    return { cls: "bg-hard", title: "Handle not found on this platform" };
  if (p.status === "blocked")
    return { cls: "bg-medium", title: "Platform is blocking us — will retry" };
  if (p.stats?.fetch_status === "partial")
    return { cls: "bg-medium", title: "Partly fetched — still filling in" };
  if (!p.last_fetched_at) return { cls: "bg-muted-foreground/40", title: "Never fetched" };

  const ageH = (Date.now() - Date.parse(p.last_fetched_at)) / 3_600_000;
  if (ageH > 72)
    return { cls: "bg-muted-foreground/40", title: `Last updated ${Math.round(ageH / 24)}d ago` };
  return { cls: "bg-easy", title: `Updated ${ageH < 1 ? "just now" : `${Math.round(ageH)}h ago`}` };
}

export function PlatformStrip({
  platforms,
  masked,
}: {
  platforms: StudentPlatformSummary[];
  masked: boolean;
}) {
  if (platforms.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
          Platforms
        </h2>
        <span className="font-mono text-3xs text-muted-foreground">
          {platforms.length} connected
        </span>
      </div>

      {/* Scrolls on its own rather than widening the page — a student on six
          platforms must not give the whole profile a horizontal scrollbar. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {platforms.map((p) => {
          const h = headline(p);
          const dot = freshness(p);
          const rank = p.rank;

          return (
            <div
              key={p.platform_id}
              className="min-w-[190px] flex-1 rounded-lg border border-border bg-surface p-3"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">{p.name}</span>
                <span className={`size-1.5 shrink-0 rounded-full ${dot.cls}`} title={dot.title} />
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold leading-none text-foreground">{h.value}</span>
                <span className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
                  {h.label}
                </span>
              </div>

              {/* Both ranks, because they answer different questions: one is
                  "where am I here", the other "where am I overall". */}
              {rank ? (
                <div className="mt-2 flex items-center gap-2 font-mono text-3xs text-muted-foreground">
                  <span className="text-primary">
                    #{rank.college_rank}
                    <span className="text-muted-foreground">/{rank.college_total}</span>
                  </span>
                  <span className="opacity-40">college</span>
                  <span className="ml-auto">
                    #{rank.overall_rank}
                    <span className="opacity-60">/{rank.overall_total}</span>
                  </span>
                </div>
              ) : (
                <div className="mt-2 font-mono text-3xs text-muted-foreground opacity-60">
                  unranked
                </div>
              )}

              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                {p.profile_url && !masked ? (
                  <a
                    href={p.profile_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 truncate font-mono text-3xs text-muted-foreground hover:text-primary"
                    title={p.handle}
                  >
                    @{p.handle}
                    <ExternalLink className="size-2.5 shrink-0" />
                  </a>
                ) : (
                  <span
                    className="truncate font-mono text-3xs text-muted-foreground"
                    title={p.handle}
                  >
                    @{p.handle}
                  </span>
                )}
                {p.score_contribution != null && p.score_contribution > 0 && (
                  <span
                    className="shrink-0 font-mono text-3xs text-primary"
                    title="Contribution to this student's Almanac Score"
                  >
                    +{compact(p.score_contribution)}
                  </span>
                )}
              </div>

              {p.fetch_error && (
                <div
                  className="mt-1.5 flex items-start gap-1 text-3xs text-hard"
                  title={p.fetch_error}
                >
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span className="line-clamp-2">{p.fetch_error}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
