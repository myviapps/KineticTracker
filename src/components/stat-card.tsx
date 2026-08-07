import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  default: { icon: "text-muted-foreground", accent: "border-border" },
  primary: { icon: "text-primary", accent: "border-l-primary" },
  easy: { icon: "text-easy", accent: "border-l-easy" },
  medium: { icon: "text-medium", accent: "border-l-medium" },
  hard: { icon: "text-hard", accent: "border-l-hard" },
} as const;

export type StatTone = keyof typeof TONES;

/**
 * Instrument-panel stat card.
 *
 * The value line is fixed-height and tabular-numeral so nothing reflows when
 * live data lands — "—" and 128,473 occupy the same box. The hint is pinned to
 * the bottom via mt-auto, so a card that gains a hint doesn't push its
 * neighbors around either.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  className?: string;
  valueClassName?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "flex min-h-[7.25rem] flex-col rounded-xl border border-border bg-surface p-4 transition-colors duration-base hover:border-primary/40",
        tone !== "default" && "border-l-2",
        t.accent,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {Icon && <Icon className={cn("size-4 shrink-0", t.icon)} aria-hidden />}
      </div>
      <div
        className={cn(
          "mt-2.5 min-h-[2.25rem] font-mono text-2xl font-bold leading-none tabular-nums lg:text-3xl",
          valueClassName,
        )}
      >
        {value}
      </div>
      <div className="mt-auto pt-2">
        {hint && (
          <div className="font-mono text-[10px] leading-snug text-muted-foreground">{hint}</div>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-3", className)}>
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {children}
      </h2>
      {right}
    </div>
  );
}
