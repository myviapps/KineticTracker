import { Progress } from "@/components/ui/progress";
import { useRefreshJobStatus } from "@/hooks/use-refresh-job";

/**
 * Live refresh banner, mounted under the sticky header.
 *
 * It used to go straight from `return null` to a full-height bar, shoving every
 * page down by ~34px in a single frame. `.strip-enter` (styles.css) animates a
 * grid-rows collapse instead, so the space opens up rather than appearing.
 */
export function RefreshProgressStrip() {
  const { job } = useRefreshJobStatus();

  if (!job) return null;

  const isActive = job.status === "queued" || job.status === "running";
  const isPaused = job.status === "paused";

  if (!isActive && !isPaused) return null;

  const progress = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

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
              {isPaused
                ? "Refresh paused — rate limited"
                : `Refreshing ${job.scope} — ${job.processed}/${job.total} students`}
            </span>
            <span className="font-mono text-muted-foreground">
              ✓ {job.succeeded} · ✕ {job.failed}
            </span>
          </div>
          {job.total > 0 && <Progress value={progress} className="mt-1 h-1" />}
        </div>
      </div>
    </div>
  );
}
