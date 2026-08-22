import { Link } from "@tanstack/react-router";
import { ArrowDown, Search } from "lucide-react";

import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { HeroSearch } from "@/components/landing/hero-search";
import { StatsStrip } from "@/components/landing/stats-strip";
import { PerspectiveFrame } from "@/components/landing/perspective-frame";
import { ShowcaseHeatmap } from "@/components/landing/showcase-heatmap";
import { ShowcaseLeaderboard } from "@/components/landing/showcase-leaderboard";

/**
 * The hero uses NO motion library. The entrance is the CSS pattern
 * `animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards` with indexed
 * `animationDelay`, which paints on the first frame with zero JS and no
 * hydration gap on the LCP element.
 *
 * This is not a style preference. `Reveal` drives `whileInView`, which holds
 * `opacity: 0` until JS and the IntersectionObserver land — wrapping anything
 * above the fold in it would flash an empty hero on every load. See the note in
 * reveal.tsx.
 */
export function Hero() {
  const { user } = useRole();

  return (
    <section className="relative flex flex-col items-center px-4 pb-24 pt-20 text-center sm:px-6 sm:pt-28">
      <div className="flex w-full max-w-3xl flex-col items-center">
        <div className="animate-in fade-in fill-mode-backwards" style={{ animationDelay: "0ms" }}>
          <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-2xs font-bold uppercase tracking-widest text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Eight platforms · one profile
          </span>
        </div>

        {/*
          `lp-display` is the wide grotesque (Archivo at wdth 115). Two sizes on
          the whole page, and this is the larger one — the type contrast against
          the mono eyebrow above and the mono stat labels below IS the type
          system, so the headline does not need a gradient or an outline to
          carry weight.
        */}
        <h1
          className="lp-display mt-6 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards text-[2.6rem] sm:text-6xl lg:text-7xl"
          style={{ animationDelay: "60ms" }}
        >
          Every solved problem.
          <br />
          <span className="text-primary">One clear view.</span>
        </h1>

        <p
          className="mt-6 max-w-xl animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards text-base text-muted-foreground sm:text-lg"
          style={{ animationDelay: "120ms" }}
        >
          {user
            ? "Search your classrooms by name, roll number, or any platform handle."
            : "LeetCode, Codeforces, AtCoder, GeeksforGeeks, HackerRank, CodeChef, HackerEarth and Code360 — merged into one profile per student."}
        </p>

        <div
          className="mt-8 w-full animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
          style={{ animationDelay: "180ms" }}
        >
          <HeroSearch />
        </div>

        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
          style={{ animationDelay: "240ms" }}
        >
          <Button asChild variant="outline" size="lg" className="h-11 rounded-full px-6">
            <Link to="/search">
              <Search className="size-4" />
              Open full search
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="h-11 rounded-full px-6">
            <a href="#features">
              See how it works
              <ArrowDown className="size-4" />
            </a>
          </Button>
        </div>
      </div>

      {/*
        The thesis: the actual classroom surface, tilted into the field. Placed
        after the search rather than before it so the page still opens on a
        sentence and an input — the two things a first-time visitor needs —
        with the product as the proof underneath.

        Deliberately outside the max-w-3xl column: the frame is max-w-5xl, so
        the product reads as wider than the copy that introduces it.
      */}
      <div
        className="mt-16 w-full animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
        style={{ animationDelay: "300ms" }}
      >
        <PerspectiveFrame>
          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="flex flex-col rounded-lg border border-border p-4">
              <div className="mb-3 font-mono text-3xs font-bold uppercase tracking-widest text-muted-foreground">
                Submission activity
              </div>
              <div className="my-auto">
                <ShowcaseHeatmap />
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <ShowcaseLeaderboard />
            </div>
          </div>
        </PerspectiveFrame>
      </div>

      <StatsStrip />
    </section>
  );
}
