import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import { SITE_URL } from "@/lib/site";
import { SignalField } from "@/components/landing/signal-field";
import { LandingHeader } from "@/components/landing/landing-header";
import { Hero } from "@/components/landing/hero";
import { PlatformRail } from "@/components/landing/platform-rail";
import { BentoFeatures } from "@/components/landing/bento-features";
import { Showcase } from "@/components/landing/showcase";
import { Roles } from "@/components/landing/roles";
import { Faq } from "@/components/landing/faq";
import { FinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/landing-footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Almanac — every solved problem, one clear view" },
      {
        name: "description",
        content:
          "Almanac tracks solving activity across eight coding platforms — LeetCode, Codeforces, AtCoder, GeeksforGeeks, HackerRank, CodeChef, HackerEarth and Code360 — as heatmaps, leaderboards and reports. Private by default, built for placement teams.",
      },
      { property: "og:title", content: "Almanac — every solved problem, one clear view" },
      {
        property: "og:description",
        content:
          "One profile per student across eight platforms: LeetCode, Codeforces, AtCoder, GeeksforGeeks, HackerRank, CodeChef, HackerEarth and Code360. Heatmaps, leaderboards and reports — private by default.",
      },
      { property: "og:url", content: `${SITE_URL}/` },
      {
        property: "og:image",
        content: `${SITE_URL}/og.png`,
      },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "Almanac — track solving progress across coding platforms",
      },
      { name: "twitter:image", content: `${SITE_URL}/og.png` },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
  }),
  component: LandingPage,
});

/**
 * The marketing page: one composition of sections wrapped in a single
 * MotionConfig. `reducedMotion="user"` is required, not optional — the CSS
 * reduced-motion block in styles.css does nothing to `motion` (which drives
 * WAAPI/JS), and MotionConfig does nothing to the CSS animations. Both are
 * needed, and they are independent.
 */
function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      {/*
        `overflow-x-clip`, NOT `overflow-hidden`.

        LandingHeader has had `sticky top-0 z-40` all along, and it did nothing:
        an ancestor with `overflow: hidden` establishes a scroll container, and a
        sticky child sticks to THAT rather than to the viewport — so the nav
        scrolled away like a static header and the bug looked like a missing
        class on the header itself.

        The clipping is still needed (the grid backdrop and the marquee both
        overhang horizontally). `overflow-x: clip` clips without creating a
        scroll container, which is exactly the difference that keeps sticky
        working on the viewport.
      */}
      {/*
        `lp` scopes the entire signal-grid token set to this page. Every landing
        colour resolves through it, and nothing outside this subtree sees any of
        it — the dashboard, sidebar and app charts keep the shared tokens
        untouched.
      */}
      <div className="lp relative isolate flex min-h-screen flex-col overflow-x-clip">
        <SignalField />
        <LandingHeader />
        <main className="flex-1">
          <Hero />
          <PlatformRail />
          <BentoFeatures />
          <Showcase />
          <Roles />
          <Faq />
          <FinalCta />
        </main>
        <LandingFooter />
      </div>
    </MotionConfig>
  );
}
