import { Progress } from "@/components/ui/progress";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { useRefreshJobStatus, type RefreshJobView } from "@/hooks/use-refresh-job";

/**
 * Live refresh banner, mounted under the sticky header.
 *
 * It used to go straight from `return null` to a full-height bar, shoving every
 * page down by ~34px in a single frame. `.strip-enter` (styles.css) animates a
 * grid-rows collapse instead, so the space opens up rather than appearing.
 *
 * Shows the aggregate first and then a row per platform. The per-platform rows
 * are not decoration: with one job per platform, a single platform tripping its
 * circuit breaker parks only itself, and the aggregate alone would show that as
 * an unexplained slowdown rather than as "CodeChef is rate limited".
 */
export function RefreshProgressStrip() {
  const { jobs, active, status, processed, total, succeeded, failed } = useRefreshJobStatus();

  const shownProcessed = useAnimatedNumber(processed);

  if (!active) return null;

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const paused = status === "paused";

  return (
    <div className="strip-enter">
      <div>
        <div
          className="border-b border-border bg-primary/5 px-4 py-1.5 text-xs"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-primary">
              {paused
                ? "Refresh paused — rate limited"
                : total > 0
                  ? `Refreshing — ${shownProcessed.toLocaleString()}/${total.toLocaleString()} accounts`
                  : "Starting refresh…"}
            </span>
            <span className="font-mono text-muted-foreground">
              ✓ {succeeded} · ✕ {failed}
            </span>
          </div>

          {total > 0 && <Progress value={pct} className="mt-1 h-1" />}

          {/* One row per platform once there is more than one in flight. A
              single-platform refresh says everything it needs to above. */}
          {jobs.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
              {jobs.map((j) => (
                <PlatformRow key={j.id} job={j} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlatformRow({ job }: { job: RefreshJobView }) {
  const jobTotal = job.total ?? 0;
  const shown = useAnimatedNumber(job.processed ?? 0);

  const tone =
    job.status === "paused"
      ? "text-medium"
      : job.status === "running"
        ? "text-foreground"
        : "text-muted-foreground";

  const detail =
    job.status === "paused"
      ? job.resume_after
        ? `paused → ${new Date(job.resume_after).toLocaleTimeString()}`
        : "paused"
      : job.status === "queued"
        ? "queued"
        : jobTotal > 0
          ? `${shown.toLocaleString()}/${jobTotal.toLocaleString()}`
          : "starting…";

  return (
    <span className={tone} title={job.last_error ?? undefined}>
      {job.platform_name} <span className="opacity-70">{detail}</span>
      {(job.failed ?? 0) > 0 && <span className="ml-1 text-hard">✕{job.failed}</span>}
    </span>
  );
}
