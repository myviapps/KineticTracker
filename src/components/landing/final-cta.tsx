import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/landing/reveal";

/**
 * Closing CTA band. Reuses the `.landing-glow` wash from the hero with a local
 * `--landing-glow` override — same atmosphere, brighter since there is no grid
 * behind it to compete with.
 */
export function FinalCta() {
  const { user } = useRole();

  return (
    <section className="relative px-4 py-28 sm:px-6">
      <div
        className="landing-glow pointer-events-none absolute inset-0"
        style={{ "--landing-glow": 0.3 } as React.CSSProperties}
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
        {/* The page's second display size — the only other place `lp-display`
            appears. Two sizes is the whole scale. */}
        <h2 className="lp-display text-3xl sm:text-5xl">
          See what your cohort is <span className="text-primary">really</span> doing
        </h2>
        <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
          Heatmaps, leaderboards and reports from the platforms your students already solve on —
          ready in minutes, private by default.
        </p>
        <Reveal className="mt-8 flex flex-wrap items-center justify-center gap-3" delay={0.1}>
          <Button asChild size="lg" className="h-11 rounded-full px-8">
            <Link to={user ? "/dashboard" : "/auth"}>
              {user ? "Open dashboard" : "Get started"}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 rounded-full px-8">
            <Link to="/search">
              <Search className="size-4" />
              Try the search
            </Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
