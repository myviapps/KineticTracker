import { useState } from "react";
import { cn } from "@/lib/utils";

const PRESETS = [10, 20, 50] as const;

/** What "All" looks like in a URL. `Infinity` does not survive JSON. */
export const TOP_N_ALL = "all";

/**
 * Read a top-N out of a search param.
 *
 * Mirrors `clampTrendDays`: the URL is user-editable, so a hand-typed value has
 * to degrade to the default view rather than to `slice(0, NaN)` — which returns
 * an empty leaderboard and reads as "this cohort has nobody in it".
 */
export function parseTopN(v: unknown, fallback = 10): number {
  if (v === TOP_N_ALL) return Infinity;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** The inverse, for writing back to the URL. */
export function serializeTopN(n: number): string {
  return Number.isFinite(n) ? String(n) : TOP_N_ALL;
}

/**
 * Picks how many students a leaderboard chart shows.
 *
 * Presets above the cohort size are hidden rather than disabled — offering
 * "Top 50" to a classroom of 12 is noise. `value` of `Infinity` means "all",
 * which the caller can pass straight to `slice`.
 */
export function TopNControl({
  value,
  max,
  onChange,
  className,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const [custom, setCustom] = useState("");
  const presets = PRESETS.filter((n) => n < max);
  const isPreset = presets.includes(value as (typeof PRESETS)[number]);
  const isAll = value >= max;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        Top
      </span>
      {presets.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => {
            setCustom("");
            onChange(n);
          }}
          aria-pressed={value === n}
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[11px] font-bold transition-colors",
            value === n
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setCustom("");
          onChange(Infinity);
        }}
        aria-pressed={isAll}
        className={cn(
          "rounded px-2 py-0.5 font-mono text-[11px] font-bold transition-colors",
          isAll
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        All
      </button>
      <input
        type="number"
        min={1}
        max={max}
        inputMode="numeric"
        placeholder="#"
        aria-label="Custom count"
        value={custom !== "" ? custom : !isPreset && !isAll ? String(value) : ""}
        onChange={(e) => {
          setCustom(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 1) onChange(Math.min(n, max));
        }}
        className="h-6 w-12 rounded border border-border bg-background px-1.5 text-center font-mono text-[11px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

/** Bar charts need room per row, or 50 students render as unreadable slivers. */
export function chartHeight(count: number): number {
  return Math.max(288, Math.min(count, 60) * 26);
}
