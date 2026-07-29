import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enqueueRefresh } from "@/lib/refresh-jobs.functions";
import { REFRESH_JOB_KEY, useRefreshJobStatus } from "@/hooks/use-refresh-job";

export function RefreshButton({
  scope,
  classroomId,
}: {
  scope: "classroom" | "platform";
  classroomId?: string;
}) {
  const { job, isLoading } = useRefreshJobStatus();
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueRefresh);

  const enqueueM = useMutation({
    mutationFn: () =>
      enqueue({
        data: { scope, classroomId: scope === "classroom" ? classroomId : undefined },
      }),
    // Without this the UI shows nothing until the next poll — which, while idle,
    // is up to 15s away. That reads as "the button does nothing".
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });
      toast.success("Refresh queued");
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const isActive = job && (job.status === "queued" || job.status === "running");
  const isPaused = job?.status === "paused";
  // Label by the RUNNING job's scope, not this button's — a classroom refresh
  // also disables the platform button (single-flight), and vice versa.
  const jobLabel =
    job?.scope === "platform" ? "platform" : job?.scope === "classroom" ? "classroom" : "students";

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
        {job.status === "queued"
          ? `Starting ${jobLabel} refresh…`
          : `Refreshing ${jobLabel} — ${job.processed}/${job.total}`}
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
