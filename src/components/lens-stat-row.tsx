import { useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils";
import type { LensStatCards } from "@/lib/platform-lens";

/**
 * Zone 1: four cards, one row, plus everything else behind a disclosure.
 *
 * The page used to render six to eight cards here and then the child report
 * rendered five more underneath — eleven numbers before you reached a student's
 * name. Four is the most that stays comparable at a glance and the most that
 * fits one row at 1280px without wrapping.
 *
 * The rest is not deleted, only folded away: `lensStatCards` returns it as
 * `secondary` and it opens in place.
 */
export function LensStatRow({
  cards,
  icons,
  fallbackIcon,
  extra,
}: {
  cards: LensStatCards;
  /** label -> icon. Anything unmapped uses fallbackIcon. */
  icons?: Record<string, LucideIcon>;
  fallbackIcon?: LucideIcon;
  /** Lens-specific cards the page wants inside the disclosure (e.g. LeetCode). */
  extra?: LensStatCards["secondary"];
}) {
  const [open, setOpen] = useState(false);
  const more = [...cards.secondary, ...(extra ?? [])];

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.primary.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            hint={c.hint}
            tone={c.tone}
            icon={icons?.[c.label] ?? fallbackIcon}
          />
        ))}
      </div>

      {more.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            {open ? "less" : `${more.length} more stat${more.length === 1 ? "" : "s"}`}
          </button>

          {open && (
            <div className="mt-2 grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 lg:grid-cols-4">
              {more.map((c) => (
                <StatCard
                  key={c.label}
                  label={c.label}
                  value={c.value}
                  hint={c.hint}
                  tone={c.tone}
                  icon={icons?.[c.label] ?? fallbackIcon}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
