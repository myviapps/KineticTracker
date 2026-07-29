import { Progress } from "@/components/ui/progress";
import { useRefreshJob } from "@/hooks/use-refresh-job";

export function RefreshProgressStrip() {
  const { data: job } = useRefreshJob();

  if (!job) return null;

  const isActive = job.status === "queued" || job.status === "running";
  const isPaused = job.status === "paused";

  if (!isActive && !isPaused) return null;

  const progress = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="border-b border-border bg-primary/5 px-4 py-1.5 text-xs">
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
      {job.total > 0 && (
        <Progress value={progress} className="mt-1 h-1" />
      )}
    </div>
  );
}
