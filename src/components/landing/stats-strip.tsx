import { useQuery } from "@tanstack/react-query";

import { getLandingStats, type LandingStats } from "@/lib/landing.functions";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { RevealGroup, Reveal } from "@/components/landing/reveal";

const TILES: { key: keyof LandingStats; label: string }[] = [
  { key: "students", label: "Students tracked" },
  { key: "problemsSolved", label: "Problems solved" },
  { key: "classrooms", label: "Classrooms" },
  { key: "colleges", label: "Colleges" },
];

/**
 * Live-ish aggregates for the hero. Counts only — no names, no rolls, no
 * "top performer" — the masking work in lib/mask.ts stays intact. Each tile
 * degrades to "—" independently: the server function never throws and returns
 * null per field, and the tiles' height is fixed so a missing number doesn't
 * reflow the hero (CLS stays 0).
 */
export function StatsStrip() {
  const { data, isPending } = useQuery({
    queryKey: ["landing-stats"],
    queryFn: () => getLandingStats(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return (
    <RevealGroup className="mt-14 grid w-full max-w-3xl grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {TILES.map((t) => (
        <Reveal key={t.key}>
          <div className="rounded-xl border border-border bg-surface/60 p-4 backdrop-blur sm:p-5">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t.label}
            </div>
            {/*
              `justify-center`, not just `items-center`. The hero sets
              text-center, so each tile's LABEL centred while its NUMBER did
              not — a flex container ignores text-align for its items, and
              items-center only handles the cross (vertical) axis. The result
              was centred captions above left-hugging figures.
            */}
            <div className="mt-2 flex h-11 items-center justify-center font-mono text-3xl font-bold tabular-nums sm:h-14 sm:text-4xl lg:text-5xl">
              {isPending ? (
                <Skeleton className="h-9 w-20 sm:h-11 sm:w-24" />
              ) : data && data[t.key] !== null ? (
                <CountUp value={data[t.key] as number} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </Reveal>
      ))}
    </RevealGroup>
  );
}

/** Count-up that respects prefers-reduced-motion (see use-animated-number). */
function CountUp({ value }: { value: number }) {
  const shown = useAnimatedNumber(value, 900);
  return <>{shown.toLocaleString()}</>;
}
