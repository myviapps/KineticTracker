import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bento card primitive — border, surface, and a hover glow that stays on
 * palette (primary amber, kept faint). Children fill the card; the card
 * itself never scrolls or clips layout work.
 */
export function BentoCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // `lp-panel-surface` carries the hairline + translucent panel + blur.
        // No shadow anywhere on this page: a shadow implies a light source and
        // lifts the card off the field, which is the opposite of the intended
        // read — these are cut OUT of the grid, not floating above it.
        "lp-panel-surface group relative flex flex-col overflow-hidden rounded-xl p-6 transition-colors duration-base",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-menu group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, color-mix(in oklab, var(--primary) 7%, transparent), transparent 60%)",
        }}
      />
      <div className="relative flex h-full flex-col">{children}</div>
    </div>
  );
}
