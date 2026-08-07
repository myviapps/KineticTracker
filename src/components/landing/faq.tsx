import { FAQS } from "@/components/landing/landing-content";
import { Reveal } from "@/components/landing/reveal";
import { SectionTitle } from "@/components/stat-card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function Faq() {
  return (
    /*
      max-w-6xl, matching #features / #showcase / #roles and the header and
      footer rails. It was max-w-3xl, which centred the whole section and pushed
      its heading 192px inboard of every other section heading (measured at
      1440px: every other content section starts at x=144, this one started at
      x=336).

      The accordion then spans the FULL rail rather than sitting at 3xl inside
      it. Left-aligning a narrower block fixed the heading but left the rows
      stopping ~380px short of where every card above them ends, and a ragged
      right edge reads as misalignment just as plainly as a wrong left edge does.
      Only the ANSWER text is capped, below — long measure hurts reading, but a
      question row and its chevron want the same width as everything else.
    */
    <section id="faq" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionTitle>Questions, answered</SectionTitle>
      <Reveal>
        <Accordion type="single" collapsible defaultValue="0" className="w-full">
          {FAQS.map((f, i) => (
            <AccordionItem key={f.q} value={String(i)}>
              <AccordionTrigger className="text-left text-sm font-medium">{f.q}</AccordionTrigger>
              <AccordionContent className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}
