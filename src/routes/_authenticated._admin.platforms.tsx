import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Pause, Play, RefreshCw } from "lucide-react";

import {
  listPlatformHealth,
  setPlatformEnabled,
  resetPlatformBreaker,
  refreshPlatform,
  type PlatformHealth,
} from "@/lib/platforms.functions";
import { SectionTitle } from "@/components/stat-card";
import { AnimatedLoader } from "@/components/animated-loader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const healthQO = () =>
  queryOptions({
    queryKey: ["platform-health"],
    queryFn: () => listPlatformHealth(),
    // A parked breaker clears on its own timer, so a stale page misleads.
    refetchInterval: 20_000,
  });

export const Route = createFileRoute("/_authenticated/_admin/platforms")({
  head: () => ({ meta: [{ title: "Platforms — Almanac" }] }),
  loader: ({ context }) => {
    if (typeof window !== "undefined") return context.queryClient.ensureQueryData(healthQO());
  },
  component: PlatformsPage,
  pendingComponent: () => <AnimatedLoader text="Loading platform health…" />,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

const TIER_COPY: Record<string, string> = {
  api: "Documented API — most reliable",
  json: "Undocumented JSON — can change without notice",
  html: "HTML scrape — breaks on redesign",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function PlatformsPage() {
  const { platforms } = useSuspenseQuery(healthQO()).data;
  const qc = useQueryClient();

  const toggle = useServerFn(setPlatformEnabled);
  const reset = useServerFn(resetPlatformBreaker);
  const refresh = useServerFn(refreshPlatform);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["platform-health"] });

  const mToggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggle({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(`${v.id} ${v.enabled ? "enabled" : "disabled"}`);
      invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });
  const mReset = useMutation({
    mutationFn: (id: string) => reset({ data: { id } }),
    onSuccess: () => {
      toast.success("Circuit breaker cleared");
      invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });
  const mRefresh = useMutation({
    mutationFn: (id: string) => refresh({ data: { id } }),
    onSuccess: () => {
      toast.success("Refresh queued — the pump will pick it up");
      invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="p-6 lg:p-8">
      <SectionTitle>Platforms</SectionTitle>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Each platform refreshes independently — one being rate-limited never stalls the others.
      </p>

      <div className="space-y-3">
        {platforms.map((p) => (
          <PlatformRow
            key={p.id}
            p={p}
            busy={mToggle.isPending || mReset.isPending || mRefresh.isPending}
            onToggle={(enabled) => mToggle.mutate({ id: p.id, enabled })}
            onReset={() => mReset.mutate(p.id)}
            onRefresh={() => mRefresh.mutate(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PlatformRow({
  p,
  busy,
  onToggle,
  onReset,
  onRefresh,
}: {
  p: PlatformHealth;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const parked = p.job_status === "paused";
  const coverage = p.accounts > 0 ? Math.round((p.fresh / p.accounts) * 100) : 0;

  return (
    <div
      className={`rounded-lg border bg-surface p-4 ${
        parked ? "border-medium/60" : p.enabled ? "border-border" : "border-border opacity-70"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={p.enabled}
          disabled={busy || !p.has_adapter}
          onCheckedChange={onToggle}
          aria-label={`Enable ${p.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold">{p.name}</span>
            <span
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
              title={TIER_COPY[p.tier]}
            >
              {p.tier}
            </span>
            {/* A registered platform with no adapter is a configurable slot, not
                a bug — say so rather than leaving a switch that does nothing. */}
            {!p.has_adapter && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                no adapter yet
              </span>
            )}
            {parked && (
              <span className="inline-flex items-center gap-1 rounded bg-medium/15 px-1.5 py-0.5 font-mono text-[10px] text-medium">
                <Pause className="size-3" /> paused · resumes {ago(p.resume_after)}
              </span>
            )}
            {p.job_status === "running" && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                <Play className="size-3" /> running {p.job_progress}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            batch {p.batch_size} · cooldown {p.base_cooldown_ms}ms · ttl {p.refresh_ttl_hours}h ·
            concurrency {p.max_concurrency}
          </div>
        </div>

        <div className="flex gap-2">
          {parked && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReset}>
              Clear breaker
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !p.enabled || !p.has_adapter}
            onClick={onRefresh}
          >
            <RefreshCw className="mr-1 size-3" /> Run now
          </Button>
        </div>
      </div>

      {p.accounts > 0 && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs sm:grid-cols-6">
            <Cell label="Accounts" value={p.accounts} />
            <Cell
              label="Fresh"
              value={`${p.fresh} · ${coverage}%`}
              tone={coverage < 50 ? "warn" : "ok"}
            />
            <Cell label="Partial" value={p.partial} tone={p.partial > 0 ? "warn" : undefined} />
            <Cell label="Invalid" value={p.invalid} tone={p.invalid > 0 ? "bad" : undefined} />
            <Cell label="Blocked" value={p.blocked} tone={p.blocked > 0 ? "bad" : undefined} />
            <Cell label="Last fetch" value={ago(p.last_fetched_at)} />
          </div>

          {/* A parse_error means OUR adapter broke, not the student's handle —
              surfacing the raw message is the difference between a five-minute
              fix and a week of quietly wrong numbers. */}
          {(p.last_error || p.sample_error) && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-hard/30 bg-hard/5 p-2 text-[11px] text-hard">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="break-words">{p.last_error ?? p.sample_error}</span>
            </div>
          )}
        </>
      )}

      {p.accounts === 0 && (
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          No student handles yet — import a column named “{p.id}” to start tracking it.
        </div>
      )}

      {p.notes && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
            adapter notes
          </summary>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.notes}</p>
        </details>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "bad";
}) {
  const color =
    tone === "bad"
      ? "text-hard"
      : tone === "warn"
        ? "text-medium"
        : tone === "ok"
          ? "text-easy"
          : "";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-bold ${color}`}>{value}</div>
    </div>
  );
}
