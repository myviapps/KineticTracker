import { useState } from "react";
import { cn } from "@/lib/utils";

const PRESETS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1y" },
] as const;

/** Matches the server-side clamp in performance.functions.ts. */
export const MIN_TREND_DAYS = 1;
export const MAX_TREND_DAYS = 365;

export function clampTrendDays(n: unknown, fallback = 30): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_TREND_DAYS, Math.max(MIN_TREND_DAYS, v));
}

/**
 * Picks the trend chart's lookback window.
 *
 * Presets plus a free number, rather than presets alone: the useful window is a
 * property of how long this cohort has been collecting, not of what we guessed.
 * A cohort three weeks old wants 21; a placement review wants the academic year.
 *
 * The custom box is clamped on change rather than validated on blur, so a typo
 * cannot send 9999 to a server function that would reject it — the widened
 * window is a query parameter, and a rejected query renders an empty chart that
 * looks exactly like "no data".
 */
export function TrendWindowControl({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (days: number) => void;
  className?: string;
}) {
  const [custom, setCustom] = useState("");
  const isPreset = PRESETS.some((p) => p.days === value);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        Window
      </span>
      {PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => {
            setCustom("");
            onChange(p.days);
          }}
          aria-pressed={value === p.days}
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[11px] font-bold transition-colors",
            value === p.days
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
      <input
        type="number"
        min={MIN_TREND_DAYS}
        max={MAX_TREND_DAYS}
        inputMode="numeric"
        placeholder="d"
        aria-label="Custom window in days"
        value={custom !== "" ? custom : isPreset ? "" : String(value)}
        onChange={(e) => {
          setCustom(e.target.value);
          // Empty means "still typing", not "zero days".
          if (e.target.value !== "") onChange(clampTrendDays(e.target.value));
        }}
        className="h-6 w-12 rounded border border-border bg-background px-1.5 text-center font-mono text-[11px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
