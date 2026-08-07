import { cn } from "@/lib/utils";

interface AlmanacLogoProps {
  size?: number;
  showText?: boolean;
  animated?: boolean;
  className?: string;
}

/**
 * Almanac — the brand mark is the product's own submission heatmap.
 *
 * A 4x4 grid of days whose density climbs toward the bottom-right, so the mark
 * reads as a cohort improving over a term rather than as a decorative checker.
 *
 * Colors come from the theme, not from the mark: lit days are `currentColor`
 * (the wrapper sets `text-primary`, the platform amber) at four intensities,
 * unlit days use `--muted-foreground`. That keeps the logo correct in both
 * themes and in step with the rest of the UI if the palette ever moves.
 */

/** Intensity per cell, row-major. 0 = no activity, 3 = a heavy day. */
const DAYS = [0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 3, 2, 2, 3, 2, 3];

const LIT_OPACITY = [0, 0.34, 0.66, 1];
const TRACK = [3, 9.5, 16, 22.5]; // 4 columns/rows of 5px cells across a 32 grid

export function AlmanacLogo({
  size = 32,
  showText = true,
  animated = false,
  className,
}: AlmanacLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Almanac"
        className="shrink-0 text-primary"
      >
        {DAYS.map((intensity, i) => {
          const row = Math.floor(i / 4);
          const col = i % 4;
          const lit = intensity > 0;
          const cell = (
            <rect
              x={TRACK[col]}
              y={TRACK[row]}
              width="5"
              height="5"
              rx="1.2"
              fill={lit ? "currentColor" : "var(--muted-foreground)"}
              opacity={lit ? LIT_OPACITY[intensity] : 0.28}
            />
          );

          // The wave sweeps along the diagonal, so days fill in the same
          // direction the density already climbs.
          return animated ? (
            <g key={i} className="almanac-day" style={{ animationDelay: `${(row + col) * 0.11}s` }}>
              {cell}
            </g>
          ) : (
            <g key={i}>{cell}</g>
          );
        })}
      </svg>

      {showText && (
        <span className="font-mono text-sm font-bold uppercase tracking-[0.18em]">Almanac</span>
      )}
    </div>
  );
}
