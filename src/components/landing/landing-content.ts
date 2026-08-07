import {
  CalendarDays,
  Globe2,
  ShieldCheck,
  Trophy,
  Flame,
  FileText,
  type LucideIcon,
} from "lucide-react";

/**
 * All landing-page copy lives here — no JSX, no components. Copy edits become a
 * one-file diff.
 *
 * The bento span classes MUST be literal strings. Tailwind v4 reads source text,
 * not runtime values, so `` `lg:col-span-${n}` `` compiles to nothing.
 */
export type Feature = {
  title: string;
  blurb: string;
  icon: LucideIcon;
  /** Literal Tailwind grid span classes for the bento. */
  span: string;
};

/*
  Why every card is now the same width.

  The original spans were 4/2/2/3/3/6 over a 6-column grid with fixed
  `lg:auto-rows-[13rem]` rows. That tiled perfectly on paper, but the copy did
  not fill it: "Daily matrix" was 4 columns wide AND 2 rows tall (26rem) holding
  two lines of text, and "Ready-made reports" spanned the full 6 columns to hold
  one. The result was a grid that was mostly background — the first thing you
  notice on the section.

  All six blurbs are within ~40 characters of each other, so there is no card
  that genuinely deserves more room than the others. Six equal cards at
  col-span-2 tile as 3 across x 2 down with nothing left over, and dropping the
  fixed row height lets each row hug its tallest card instead of padding every
  card out to a number picked in advance.
*/

export const FEATURES: Feature[] = [
  {
    title: "Daily matrix",
    blurb:
      "A day-by-day view of who solved what, when. Spots the quiet week before an assessment long before any aggregate metric can.",
    icon: CalendarDays,
    span: "lg:col-span-2",
  },
  {
    title: "Every platform your students use",
    blurb:
      "LeetCode, Codeforces, AtCoder, GeeksforGeeks, HackerRank, CodeChef, HackerEarth and Code360 — one scoured leaderboard across all of them.",
    icon: Globe2,
    span: "lg:col-span-2",
  },
  {
    title: "Private by design",
    blurb:
      "Public lookups show masked identities and exact-match rolls only. No directory, no enumeration, no exposed roster.",
    icon: ShieldCheck,
    span: "lg:col-span-2",
  },
  {
    title: "Live leaderboards",
    blurb:
      "Rank within a classroom or across a whole college with a difficulty-weighted score — not a raw problem count.",
    icon: Trophy,
    span: "lg:col-span-2",
  },
  {
    title: "Heatmaps that tell the story",
    blurb:
      "The submission calendar shows the shape of a term at a glance — who keeps it up, who fades, who catches fire in week eight.",
    icon: Flame,
    span: "lg:col-span-2",
  },
  {
    title: "Ready-made reports",
    blurb:
      "Term-end PDFs, classroom rollups and per-platform breakdowns. No screenshots, no copy-paste into a spreadsheet.",
    icon: FileText,
    span: "lg:col-span-2",
  },
];

export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  {
    q: "What does Almanac actually track?",
    a: "Solving activity across all eight supported platforms — daily submissions, difficulty splits, ratings, contest history and streaks — merged into one profile per student. It turns that into heatmaps, leaderboards and per-classroom reports.",
  },
  {
    q: "Is the data live?",
    a: "Each platform refreshes independently on its own schedule, so one being rate-limited never stalls the others. The refresh worker reads each platform's public profile — it does not log in as anyone or touch private account data.",
  },
  {
    q: "Are student details public?",
    a: "No. A public lookup needs a full roll number and only ever returns one masked result. Signed-in staff see unmasked details, scoped strictly to the classrooms they're assigned to.",
  },
  {
    q: "Which platforms are supported?",
    a: "LeetCode, Codeforces, AtCoder, GeeksforGeeks, HackerRank, CodeChef, HackerEarth and Code360 are live, each with its own adapter; more are configured and get flipped on as they're proven out.",
  },
  {
    q: "Who is Almanac for?",
    a: "Faculty tracking a cohort, placement officers preparing reports, and students who want to check their own progress. One account's role decides exactly how much of the directory they can see.",
  },
];

export type Role = { title: string; blurb: string; points: string[] };

export const ROLES: Role[] = [
  {
    title: "Students",
    blurb: "Check your own progress with just a roll number — no account needed.",
    points: ["Masked public profile", "Exact-roll lookup", "Nothing to sign up for"],
  },
  {
    title: "Faculty",
    blurb: "Watch a cohort stay (or stop) on track, week by week.",
    points: [
      "Your classrooms, your students",
      "Daily matrix and heatmaps",
      "No visibility outside your assignment",
    ],
  },
  {
    title: "Placement officers",
    blurb: "Turn solving activity into artifacts the industry panel can read.",
    points: ["Multi-classroom leaderboards", "Cross-platform score", "Term-end PDF reports"],
  },
  {
    title: "Administrators",
    blurb: "Run the whole institution on one dashboard.",
    points: ["College-wide overview", "Staff and classroom management", "Platform refresh control"],
  },
];

/** Real platform names from the adapters' config — the 8 that are live.
    SPOJ (Cloudflare-blocked) and InterviewBit (score/rank only) are configured
    but not working, so they don't get marketing real estate. */
export const PLATFORMS: string[] = [
  "LeetCode",
  "Codeforces",
  "AtCoder",
  "GeeksforGeeks",
  "HackerRank",
  "CodeChef",
  "HackerEarth",
  "Code360",
];
