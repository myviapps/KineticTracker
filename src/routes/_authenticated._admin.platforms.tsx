import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Pause, Play, RefreshCw, SlidersHorizontal } from "lucide-react";

import {
  listPlatformHealth,
  setPlatformEnabled,
  resetPlatformBreaker,
  refreshPlatform,
  updatePlatformTuning,
  type PlatformHealth,
} from "@/lib/platforms.functions";
import { SectionTitle } from "@/components/stat-card";
import { AnimatedLoader } from "@/components/animated-loader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
  const [tuningPlatform, setTuningPlatform] = useState<PlatformHealth | null>(null);

  const toggle = useServerFn(setPlatformEnabled);
  const reset = useServerFn(resetPlatformBreaker);
  const refresh = useServerFn(refreshPlatform);
  const saveTuning = useServerFn(updatePlatformTuning);
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

  const mTuning = useMutation({
    mutationFn: (v: {
      id: string;
      batch_size: number;
      max_concurrency: number;
      base_cooldown_ms: number;
      refresh_ttl_hours: number;
    }) => saveTuning({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(`Tuning updated for ${v.id}`, {
        description: `Batch size: ${v.batch_size} students · Concurrency: ${v.max_concurrency} concurrent workers`,
      });
      setTuningPlatform(null);
      invalidate();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="p-6 lg:p-8">
      <SectionTitle>Platforms</SectionTitle>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Each platform refreshes independently — customize batch size and concurrency to speed up
        scraping without hitting rate limits.
      </p>

      <div className="space-y-3">
        {platforms.map((p) => (
          <PlatformRow
            key={p.id}
            p={p}
            busy={mToggle.isPending || mReset.isPending || mRefresh.isPending || mTuning.isPending}
            onToggle={(enabled) => mToggle.mutate({ id: p.id, enabled })}
            onReset={() => mReset.mutate(p.id)}
            onRefresh={() => mRefresh.mutate(p.id)}
            onConfigure={() => setTuningPlatform(p)}
          />
        ))}
      </div>

      {tuningPlatform && (
        <PlatformTuningModal
          platform={tuningPlatform}
          isPending={mTuning.isPending}
          onSave={(values) => mTuning.mutate({ id: tuningPlatform.id, ...values })}
          onClose={() => setTuningPlatform(null)}
        />
      )}
    </div>
  );
}

function PlatformRow({
  p,
  busy,
  onToggle,
  onReset,
  onRefresh,
  onConfigure,
}: {
  p: PlatformHealth;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
  onRefresh: () => void;
  onConfigure: () => void;
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
            batch {p.batch_size} students · concurrency {p.max_concurrency} parallel · cooldown{" "}
            {p.base_cooldown_ms}ms · ttl {p.refresh_ttl_hours}h
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onConfigure}
            title="Configure batch size, concurrency, and cooldown"
          >
            <SlidersHorizontal className="mr-1 size-3.5" /> Tuning
          </Button>
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

function PlatformTuningModal({
  platform,
  isPending,
  onSave,
  onClose,
}: {
  platform: PlatformHealth;
  isPending: boolean;
  onSave: (values: {
    batch_size: number;
    max_concurrency: number;
    base_cooldown_ms: number;
    refresh_ttl_hours: number;
  }) => void;
  onClose: () => void;
}) {
  const [batchSize, setBatchSize] = useState(platform.batch_size);
  const [concurrency, setConcurrency] = useState(platform.max_concurrency);
  const [cooldownMs, setCooldownMs] = useState(platform.base_cooldown_ms);
  const [ttlHours, setTtlHours] = useState(platform.refresh_ttl_hours);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      batch_size: Math.max(1, Math.min(100, Math.round(Number(batchSize) || 5))),
      max_concurrency: Math.max(1, Math.min(20, Math.round(Number(concurrency) || 3))),
      base_cooldown_ms: Math.max(0, Math.min(60_000, Math.round(Number(cooldownMs) || 0))),
      refresh_ttl_hours: Math.max(1, Math.min(720, Math.round(Number(ttlHours) || 24))),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            <span>Tune {platform.name} Scraping</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure how many students to batch and how many concurrent requests/batches run in
            parallel to maximize speed.
          </DialogDescription>
        </DialogHeader>

        <form id="tuning-form" onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="batch-size" className="text-xs font-semibold">
                Students per Batch (`batch_size`)
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">1 – 100</span>
            </div>
            <Input
              id="batch-size"
              type="number"
              min={1}
              max={100}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Number of students fetched per batch chunk (e.g. 5, 10, 15).
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-concurrency" className="text-xs font-semibold">
                Concurrent Batches / Workers (`max_concurrency`)
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">1 – 20</span>
            </div>
            <Input
              id="max-concurrency"
              type="number"
              min={1}
              max={20}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Number of parallel requests running simultaneously (e.g. 3 = Batch A, B, C running
              concurrently).
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cooldown-ms" className="text-xs font-semibold">
                Cooldown between Batches (ms)
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">0 – 60,000 ms</span>
            </div>
            <Input
              id="cooldown-ms"
              type="number"
              min={0}
              max={60000}
              step={500}
              value={cooldownMs}
              onChange={(e) => setCooldownMs(Number(e.target.value))}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Base pause between batches. Adaptive cooldown automatically scales up if rate-limited.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="refresh-ttl" className="text-xs font-semibold">
                Refresh TTL (hours)
              </Label>
              <span className="font-mono text-[10px] text-muted-foreground">1 – 720 h</span>
            </div>
            <Input
              id="refresh-ttl"
              type="number"
              min={1}
              max={720}
              value={ttlHours}
              onChange={(e) => setTtlHours(Number(e.target.value))}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Data fresher than this cutoff is skipped during routine refreshes.
            </p>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="tuning-form" disabled={isPending}>
            {isPending ? "Saving…" : "Save Tuning"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
