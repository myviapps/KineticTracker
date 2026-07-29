import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enqueueRefresh } from "@/lib/refresh-jobs.functions";
import { useRefreshJob } from "@/hooks/use-refresh-job";

export function RefreshButton({
  scope,
  classroomId,
}: {
  scope: "classroom" | "platform";
  classroomId?: string;
}) {
  const { data: job, isLoading } = useRefreshJob();
  const enqueue = useServerFn(enqueueRefresh);

  const enqueueM = useMutation({
    mutationFn: () =>
      enqueue({
        data: { scope, classroomId: scope === "classroom" ? classroomId : undefined },
      }),
    onError: (e: unknown) => toast.error(String(e)),
  });

  const isActive = job && (job.status === "queued" || job.status === "running");
  const isPaused = job?.status === "paused";
  const progress = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  if (isLoading) {
    return (
      <Button variant="outline" disabled>
        <RefreshCw className="mr-1 size-4" />
        Loading…
      </Button>
    );
  }

  if (isActive) {
    return (
      <Button variant="outline" disabled>
        <RefreshCw className="mr-1 size-4 animate-spin" />
        Refreshing {scope === "platform" ? "platform" : "classroom"} — {job.processed}/{job.total}
      </Button>
    );
  }

  if (isPaused && job?.resume_after) {
    const resumeAt = new Date(job.resume_after);
    return (
      <Button variant="outline" disabled>
        <Pause className="mr-1 size-4" />
        Rate limited — resumes {resumeAt.toLocaleTimeString()}
      </Button>
    );
  }

  return (
    <Button variant="outline" onClick={() => enqueueM.mutate()} disabled={enqueueM.isPending}>
      <RefreshCw className={cn("mr-1 size-4", enqueueM.isPending && "animate-spin")} />
      {scope === "platform" ? "Refresh Platform" : "Refresh all"}
    </Button>
  );
}
