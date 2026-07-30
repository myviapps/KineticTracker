import { cn } from "@/lib/utils";
import type { SVGAttributes } from "react";

interface KineticLogoProps {
  size?: number;
  showText?: boolean;
  animated?: boolean;
  className?: string;
}

export function KineticLogo({
  size = 32,
  showText = true,
  animated = false,
  className,
}: KineticLogoProps) {

  const arc = (r: number, stroke: string, sw: number, dash: string, extra: SVGAttributes<SVGCircleElement>) => (
    <circle
      key={r}
      cx="55" cy="55" r={r}
      stroke={stroke} strokeWidth={sw}
      strokeDasharray={dash} strokeLinecap="round"
      {...extra}
    />
  );

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 110 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Static guide circles */}
          <circle cx="55" cy="55" r="48" stroke="#2d2d4a" strokeWidth={1.5} />
          <circle cx="55" cy="55" r="36" stroke="#2d2d4a" strokeWidth={1.5} />
          <circle cx="55" cy="55" r="24" stroke="#2d2d4a" strokeWidth={1.5} />
          <circle cx="55" cy="55" r="12" stroke="#2d2d4a" strokeWidth={1.5} />

          {/* Dashed arcs */}
          {arc(48, "#00b67a", 2, "75 226", {
            className: animated ? "animate-radar-arc" : "",
            style: animated
              ? { transformOrigin: "55px 55px", animationDuration: "4s" }
              : { transform: "rotate(-90deg)", transformOrigin: "55px 55px" },
          })}
          {arc(36, "#00b67a", 1.5, "50 176", {
            opacity: 0.6,
            className: animated ? "animate-radar-arc" : "",
            style: animated
              ? { transformOrigin: "55px 55px", animationDuration: "6s" }
              : { transform: "rotate(-90deg)", transformOrigin: "55px 55px" },
          })}
          {arc(24, "#ffa116", 2, "38 113", {
            className: animated ? "animate-radar-arc-reverse" : "",
            style: animated
              ? { transformOrigin: "55px 55px", animationDuration: "3s" }
              : { transform: "rotate(-90deg)", transformOrigin: "55px 55px" },
          })}

          {/* Sweep line */}
          <line
            x1="55" y1="55" x2="55" y2="7"
            stroke="#ffa116" strokeWidth={2.5} strokeLinecap="round"
            className={animated ? "animate-radar-sweep" : ""}
            style={{ transformOrigin: "55px 55px" }}
          />

          {/* Secondary line */}
          <line
            x1="55" y1="55" x2="83" y2="27"
            stroke="#3b82f6" strokeWidth={2} strokeLinecap="round"
            opacity="0.5"
          />

          {/* Data points */}
          <circle cx="55" cy="55" r="5" fill="#ffa116" />
          {animated ? (
            <>
              <g className="dot-pulse-0">
                <circle cx="55" cy="22" r="4" fill="#ffa116" />
              </g>
              <g className="dot-pulse-1">
                <circle cx="83" cy="40" r="3" fill="#3b82f6" />
              </g>
              <g className="dot-pulse-2">
                <circle cx="68" cy="80" r="3.5" fill="#ef4743" />
              </g>
            </>
          ) : (
            <>
              <circle cx="55" cy="22" r="4" fill="#ffa116" />
              <circle cx="83" cy="40" r="3" fill="#3b82f6" opacity="0.6" />
              <circle cx="68" cy="80" r="3.5" fill="#ef4743" opacity="0.6" />
            </>
          )}
        </svg>
      </div>
      {showText && (
        <span className="font-mono text-sm font-bold tracking-tight">
          KINETIC<span className="text-primary">/</span>TRACKER
        </span>
      )}
    </div>
  );
}
