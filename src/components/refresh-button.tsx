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
  const { jobs, active, status, processed, total, isLoading } = useRefreshJobStatus();
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueRefresh);

  const enqueueM = useMutation({
    mutationFn: () =>
      enqueue({
        data: { scope, classroomId: scope === "classroom" ? classroomId : undefined },
      }),
    // Without this the UI shows nothing until the next poll — which, while idle,
    // is up to 15s away. That reads as "the button does nothing".
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: REFRESH_JOB_KEY });
      const n = res?.queued?.length ?? 0;
      const busy = res?.skipped?.filter((s) => s.reason === "already running") ?? [];
      toast.success(
        `Refresh queued for ${n} platform${n === 1 ? "" : "s"}` +
          (busy.length ? ` · ${busy.map((b) => b.platformId).join(", ")} already running` : ""),
      );
    },
    onError: (e: unknown) => toast.error(String(e)),
  });

  const isActive = active && (status === "queued" || status === "running");
  const isPaused = status === "paused";
  // Label by what is RUNNING, not by this button's scope — a classroom refresh
  // also disables the platform button, and vice versa.
  const scopeLabel =
    jobs[0]?.scope === "platform"
      ? "platform"
      : jobs[0]?.scope === "classroom"
        ? "classroom"
        : "students";

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
        {status === "queued" || total === 0
          ? `Starting ${scopeLabel} refresh…`
          : `Refreshing ${scopeLabel} — ${processed}/${total}`}
      </Button>
    );
  }

  if (isPaused) {
    // Earliest resume across the paused platforms, so the button says when
    // something will actually move again.
    const resumeAt = jobs
      .map((j) => j.resume_after)
      .filter((v): v is string => !!v)
      .sort()[0];
    return (
      <Button variant="outline" disabled>
        <Pause className="mr-1 size-4" />
        {resumeAt
          ? `Rate limited — resumes ${new Date(resumeAt).toLocaleTimeString()}`
          : "Rate limited — will resume"}
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
