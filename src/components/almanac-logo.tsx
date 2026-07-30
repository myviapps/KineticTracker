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
 * Unlit days use `currentColor` so the mark sits correctly on either theme;
 * only the lit days carry the brand green.
 */

const ACCENT = "#16A34A";

/** Intensity per cell, row-major. 0 = no activity, 3 = a heavy day. */
const DAYS = [
  0, 1, 0, 2,
  1, 0, 2, 1,
  0, 2, 3, 2,
  2, 3, 2, 3,
];

const OPACITY = [0.18, 0.32, 0.62, 1];
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
        className="shrink-0"
      >
        {DAYS.map((intensity, i) => {
          const row = Math.floor(i / 4);
          const col = i % 4;
          const cell = (
            <rect
              x={TRACK[col]}
              y={TRACK[row]}
              width="5"
              height="5"
              rx="1.2"
              fill={intensity === 0 ? "currentColor" : ACCENT}
              opacity={OPACITY[intensity]}
            />
          );

          // The wave sweeps along the diagonal, so days fill in the same
          // direction the density already climbs.
          return animated ? (
            <g
              key={i}
              className="almanac-day"
              style={{ animationDelay: `${(row + col) * 0.11}s` }}
            >
              {cell}
            </g>
          ) : (
            <g key={i}>{cell}</g>
          );
        })}
      </svg>

      {showText && (
        <span className="text-sm font-medium lowercase tracking-wide">
          almanac
        </span>
      )}
    </div>
  );
}
