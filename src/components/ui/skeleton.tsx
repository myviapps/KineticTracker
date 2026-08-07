import { cn } from "@/lib/utils";

/**
 * The one skeleton surface. Loading placeholders used to be hand-rolled per page
 * with three different fills — bg-muted, bg-surface and bg-primary/10 — so the
 * three pages that had them didn't look like the same product loading.
 *
 * `animate-pulse` resolves to the shallower, slower `skeleton-breathe` keyframe
 * declared in styles.css rather than Tailwind's 50%-opacity heartbeat, which reads
 * as flicker behind a wall of cards on a dark surface.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-md bg-muted/70", className)} {...props} />
  );
}

export { Skeleton };
