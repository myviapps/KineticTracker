import { ROLES } from "@/components/landing/landing-content";
import { BentoCard } from "@/components/landing/bento-card";
import { Reveal, RevealGroup } from "@/components/landing/reveal";
import { SectionTitle } from "@/components/stat-card";

/** Four audience cards — who gets what out of Almanac. */
export function Roles() {
  return (
    <section id="roles" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionTitle>Built for everyone in the pipeline</SectionTitle>
      <RevealGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <Reveal key={r.title}>
            <BentoCard className="h-full">
              <h3 className="font-semibold tracking-tight">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.blurb}</p>
              <ul className="mt-4 space-y-2">
                {r.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </BentoCard>
          </Reveal>
        ))}
      </RevealGroup>
    </section>
  );
}
