import { cn } from "@/lib/utils";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { useRefreshJobStatus, type RefreshJobView } from "@/hooks/use-refresh-job";
import { ALL_LENS } from "@/lib/platform-lens";
import type { CohortPlatform } from "@/lib/classrooms.functions";

/**
 * The secondary sticky bar: the platform lens, pinned under the app header.
 *
 * Platform used to be a tab strip buried inside the report tab, below the stats
 * and charts it was supposed to govern — so the page showed LeetCode numbers
 * while the selector said Codeforces. Making it the first thing on the page, and
 * keeping it on screen, is what lets everything below honestly belong to one
 * platform.
 *
 * The pills double as the refresh readout. They are already exactly one per
 * platform, and the refresh now fans out one job per platform, so progress
 * belongs on the thing it is updating rather than in a separate widget.
 *
 * Sticks at `top-(--app-header-h)` with the header's own bg/blur treatment.
 * z-30 sits between the app header (z-40) and the daily matrix's frozen columns
 * (z-20). RefreshProgressStrip is in normal flow above <main>, so this simply
 * pins once the strip scrolls past — no offset math.
 */
export function CohortFilterBar({
  title,
  subtitle,
  platforms,
  value,
  onChange,
  shownCount,
  totalCount,
  status,
  right,
}: {
  title: string;
  subtitle?: string;
  platforms: CohortPlatform[];
  value: string;
  onChange: (lensId: string) => void;
  shownCount?: number;
  totalCount?: number;
  /** Ingestion health. Status, not page content — so it lives here as a badge. */
  status?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const { byPlatform, active, processed, total } = useRefreshJobStatus();

  const lenses = [{ id: ALL_LENS, name: "All platforms" }, ...platforms];

  return (
    <div className="sticky top-(--app-header-h) z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="min-w-0 shrink-0">
          <div className="truncate text-sm font-semibold leading-tight">{title}</div>
          {subtitle && (
            <div className="truncate font-mono text-3xs uppercase tracking-widest text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>

        {/* Scrolls rather than wrapping on narrow screens: a cohort on six
            platforms must not make this bar two rows tall on a laptop. */}
        <div
          role="radiogroup"
          aria-label="Platform"
          className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5"
          onKeyDown={(e) => {
            const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            const i = lenses.findIndex((l) => l.id === value);
            let next = i;
            if (e.key === "ArrowRight") next = (i + 1) % lenses.length;
            if (e.key === "ArrowLeft") next = (i - 1 + lenses.length) % lenses.length;
            if (e.key === "Home") next = 0;
            if (e.key === "End") next = lenses.length - 1;
            onChange(lenses[next].id);
            document.getElementById(`lens-${lenses[next].id}`)?.focus();
          }}
        >
          {lenses.map((l) => (
            <LensPill
              key={l.id}
              id={l.id}
              name={l.name}
              active={value === l.id}
              // The "All" pill carries the aggregate across every live job.
              job={l.id === ALL_LENS ? null : (byPlatform.get(l.id) ?? null)}
              aggregate={
                l.id === ALL_LENS && active ? { processed, total, status: "running" } : null
              }
              onSelect={() => onChange(l.id)}
            />
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {shownCount !== undefined && totalCount !== undefined && (
            <span className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
              <b className="text-foreground tabular-nums">{shownCount}</b> of{" "}
              <span className="tabular-nums">{totalCount}</span>
            </span>
          )}
          {status}
          {right}
        </div>
      </div>
    </div>
  );
}

function LensPill({
  id,
  name,
  active,
  job,
  aggregate,
  onSelect,
}: {
  id: string;
  name: string;
  active: boolean;
  job: RefreshJobView | null;
  aggregate: { processed: number; total: number; status: string } | null;
  onSelect: () => void;
}) {
  const live = job
    ? { processed: job.processed ?? 0, total: job.total ?? 0, status: job.status }
    : aggregate;

  const shown = useAnimatedNumber(live?.processed ?? 0);

  const running = !!live && (live.status === "running" || live.status === "queued");
  const paused = live?.status === "paused";
  // A queued job with no denominator yet is indeterminate — a 0% bar would read
  // as "started and got nowhere" rather than "not started".
  const determinate = !!live && live.total > 0;
  const pct = determinate ? Math.min(100, Math.round((live.processed / live.total) * 100)) : 0;

  return (
    <button
      id={`lens-${id}`}
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      title={
        paused && job?.resume_after
          ? `Rate limited — resumes ${new Date(job.resume_after).toLocaleTimeString()}`
          : (job?.last_error ?? undefined)
      }
      className={cn(
        "relative isolate shrink-0 overflow-hidden rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground",
        paused && "border-medium/60",
      )}
    >
      {/* Determinate fill. `transition-[width]` eases between the 2s polls so
          the bar glides instead of stepping. -z-10 keeps it behind the label. */}
      {running && determinate && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 -z-10 bg-primary/20 transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      )}
      {/* Indeterminate: a shimmer, never a 0% bar. */}
      {running && !determinate && (
        <span
          aria-hidden
          className="absolute inset-0 -z-10 animate-pulse bg-primary/10 motion-reduce:animate-none"
        />
      )}

      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {name}
        {running && determinate && (
          <span className="font-mono text-3xs tabular-nums opacity-80">
            {shown}/{live.total}
          </span>
        )}
        {running && !determinate && (
          <span className="font-mono text-3xs opacity-70">starting…</span>
        )}
        {paused && <span className="font-mono text-3xs text-medium">⏸</span>}
      </span>
    </button>
  );
}
