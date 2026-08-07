import { FEATURES } from "@/components/landing/landing-content";
import { BentoCard } from "@/components/landing/bento-card";
import { Reveal, RevealGroup } from "@/components/landing/reveal";
import { SectionTitle } from "@/components/stat-card";

/**
 * Bento grid: `grid-cols-1` → `sm:grid-cols-2` → `lg:grid-cols-6`, every card at
 * col-span-2 so it reads as 3 across. Span classes are literal strings from
 * landing-content.ts — the v4 scanner reads source text, not runtime values,
 * so a template string here compiles to nothing.
 *
 * No `auto-rows` height. It used to pin every row to 13rem, which is what made
 * the section look mostly empty; grid rows already stretch their cards to the
 * tallest in the row, so equal-height cards come free and the height is
 * whatever the longest blurb actually needs. See landing-content.ts.
 */
export function BentoFeatures() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionTitle>What Almanac does</SectionTitle>
      <RevealGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} className={f.span}>
            <BentoCard className="h-full">
              {/*
                Icon and index share a row. The index is NOT decorative
                numbering — these six are an unordered set, so it is set as a
                dim mono coordinate (the card's position in the grid) rather
                than as "01 / 02 / 03", which would imply a sequence the
                content does not have.
              */}
              <div className="flex items-center justify-between">
                <f.icon className="size-5 text-primary" aria-hidden />
                <span
                  aria-hidden
                  className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.blurb}</p>
            </BentoCard>
          </Reveal>
        ))}
      </RevealGroup>
    </section>
  );
}
