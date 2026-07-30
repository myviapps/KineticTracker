import { AnimatedLoader } from "@/components/animated-loader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared loading shapes.
 *
 * Only three of eleven routes had a skeleton before this; the rest either rendered
 * nothing or — worse — rendered their empty state ("No staff accounts yet", "No
 * scrape runs recorded yet") while the first request was still in flight, telling
 * the user their data didn't exist. These are the pieces those pages now use.
 *
 * Everything is marked aria-hidden by <Skeleton>; announce loading with a
 * `sr-only` live region at the page level where it matters.
 */

/** Eyebrow + title + subtitle, matching the page-header pattern used app-wide. */
export function SkeletonPageHeader({ withSubtitle = true }: { withSubtitle?: boolean }) {
  return (
    <div className="mb-8 space-y-3">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-64" />
      {withSubtitle && <Skeleton className="h-4 w-80" />}
    </div>
  );
}

/** A row of StatCard-sized tiles. */
export function SkeletonGrid({
  count = 6,
  className,
  itemClassName = "h-24",
}: {
  count?: number;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div className={cn("grid gap-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("rounded-lg", itemClassName)} />
      ))}
    </div>
  );
}

/** Bordered card wrapper so skeleton blocks keep the real layout's chrome. */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-6", className)}>
      {children}
    </div>
  );
}

/** Table placeholder that keeps the header row solid so the page doesn't jump. */
export function SkeletonTable({
  rows = 8,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex gap-4 border-b border-border bg-background/60 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stack of bordered rows — the /staff and search-result shape. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * Sidebar + header shell, used while the auth check resolves.
 *
 * Both `_authenticated` and `_admin` returned bare `null` here, so every full page
 * load flashed an empty background before anything appeared — twice over on admin
 * routes, since the layouts nest.
 */
export function AppShellSkeleton() {
  return <AnimatedLoader text="Loading…" fullscreen />;
}
