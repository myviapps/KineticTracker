import { forwardRef } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LensFilterSet } from "@/lib/platform-lens";

/**
 * Search plus the lens's filter chips, directly under the sticky bar.
 *
 * Deliberately NOT sticky. Pinning this too made the bar ~110px tall, which is a
 * real cost on a laptop; the lens is the thing you need while scrolling a long
 * roster, the chips are what you set once.
 *
 * The chips are whatever the lens says they are — the nine behavioural buckets
 * on LeetCode, metric bands elsewhere. This component renders a filter set; it
 * does not know which kind it is looking at.
 */
export const CohortToolbar = forwardRef<
  HTMLInputElement,
  {
    search: string;
    onSearch: (v: string) => void;
    filters: LensFilterSet;
    value: string;
    onFilter: (id: string) => void;
    placeholder?: string;
    /** Overview filters the page, not a roster — it has nothing to search. */
    hideSearch?: boolean;
    right?: React.ReactNode;
  }
>(function CohortToolbar(
  { search, onSearch, filters, value, onFilter, placeholder, hideSearch, right },
  ref,
) {
  const activeLabel = filters.filters.find((f) => f.id === value)?.label;

  return (
    <div className="mb-6 space-y-3">
      {!hideSearch && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={ref}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={placeholder ?? "Search name, roll, or handle… ( / )"}
              className="pl-9"
            />
          </div>
          {right}
        </div>
      )}

      <div
        role="radiogroup"
        aria-label={filters.kind === "buckets" ? "Filter students by bucket" : "Filter by band"}
        className="flex flex-wrap gap-1.5"
        onKeyDown={(e) => {
          const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const list = filters.filters;
          const i = list.findIndex((f) => f.id === value);
          let next = i;
          if (e.key === "ArrowRight") next = (i + 1) % list.length;
          if (e.key === "ArrowLeft") next = (i - 1 + list.length) % list.length;
          if (e.key === "Home") next = 0;
          if (e.key === "End") next = list.length - 1;
          onFilter(list[next].id);
          document.getElementById(`filter-${list[next].id}`)?.focus();
        }}
      >
        {filters.filters.map((f) => {
          const on = value === f.id;
          return (
            <button
              key={f.id}
              id={`filter-${f.id}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-2xs font-semibold transition-[color,background-color,border-color]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
              {f.label}
              <span className="font-bold tabular-nums">{f.count}</span>
            </button>
          );
        })}
      </div>

      {/* Says what the filter is doing in words. A chip highlighted three
          sections above the table is easy to forget you set. */}
      {value !== "all" && activeLabel && (
        <p className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
          Filtered to <b className="text-primary">{activeLabel}</b> — everything below reflects this
          group.
        </p>
      )}
    </div>
  );
});
