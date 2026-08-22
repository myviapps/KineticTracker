import { PLATFORMS } from "@/components/landing/landing-content";
import { Reveal, RevealGroup } from "@/components/landing/reveal";

/**
 * The eight live platforms, as a fixed rail rather than a scrolling marquee.
 *
 * The marquee this replaces had a specific failure: a strip of names sliding
 * past reads as "logos we could name", and it was physically impossible to see
 * all eight at once — at 1440px the loop showed six and a half. The single
 * point this page keeps failing to make is that there are EIGHT platforms and
 * all of them are live, which is exactly the claim a moving strip cannot make.
 *
 * A fixed grid states the count, holds still long enough to be counted, and
 * costs no animation frames.
 *
 * The status dot is on the difficulty ramp (`--easy`) rather than a generic
 * green, because that token is the product's own "good" and is already what a
 * healthy platform reads as everywhere else in the app.
 */
export function PlatformRail() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <p className="font-mono text-3xs font-bold uppercase tracking-widest text-muted-foreground">
          One dashboard for every platform
        </p>
        <p className="font-mono text-3xs font-bold uppercase tracking-widest text-muted-foreground">
          {PLATFORMS.length} live
        </p>
      </div>

      <RevealGroup className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {PLATFORMS.map((name) => (
          <Reveal key={name}>
            {/*
              gap-px over a token-coloured background is what draws the internal
              hairlines: it gives one shared 1px rule between cells instead of
              doubled borders, so the rail keeps a true single-pixel grid at
              every breakpoint without border-collapse tricks.
            */}
            <div className="flex h-full items-center gap-2.5 bg-background px-4 py-4 transition-colors duration-base hover:bg-surface">
              <span className="size-1.5 shrink-0 rounded-full bg-easy" aria-hidden />
              <span className="truncate font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
                {name}
              </span>
            </div>
          </Reveal>
        ))}
      </RevealGroup>
    </section>
  );
}
