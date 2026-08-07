import { ShowcaseHeatmap } from "@/components/landing/showcase-heatmap";
import { Reveal } from "@/components/landing/reveal";
import { SectionTitle } from "@/components/stat-card";

/**
 * The second product surface: a STUDENT profile, straight on.
 *
 * Deliberately not the classroom view and deliberately not tilted — the hero
 * already shows the classroom surface in perspective, and repeating the same
 * subject in the same framing halfway down the page reads as padding. Different
 * subject (one student, not a cohort), different framing (flat, dense,
 * readable), so the two sections answer two different questions: "what does my
 * cohort look like" and "what does one student's record look like".
 *
 * The numbers are the same fabricated-but-plausible set the leaderboard mock
 * uses, and the identity is masked in the product's own style ("Aarav S."), so
 * nothing here implies a real directory.
 */

/** Per-platform rows. Solved counts only — no ratings, so no platform is implied
    to be more authoritative than another. */
const ACCOUNTS = [
  { platform: "LeetCode", handle: "aarav_s", solved: 143, share: 1 },
  { platform: "Codeforces", handle: "aarav.s", solved: 61, share: 0.43 },
  { platform: "CodeChef", handle: "aaravs33", solved: 38, share: 0.27 },
  { platform: "GeeksforGeeks", handle: "aaravs", solved: 24, share: 0.17 },
] as const;

/** The difficulty split, on the product's own ramp. */
const SPLIT = [
  { label: "Easy", value: 118, tone: "bg-easy" },
  { label: "Medium", value: 122, tone: "bg-medium" },
  { label: "Hard", value: 26, tone: "bg-hard" },
] as const;

const SPLIT_TOTAL = SPLIT.reduce((a, s) => a + s.value, 0);

export function Showcase() {
  return (
    <section id="showcase" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionTitle>One student, every platform</SectionTitle>

      <Reveal>
        <div className="lp-panel-surface overflow-hidden rounded-xl">
          {/* Identity strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-sm font-bold text-primary">
              AS
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Aarav S.</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                  CSE-26-014
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                4 platforms linked · 266 solved
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Almanac score
              </div>
              <div className="lp-display text-2xl text-primary">1,042</div>
            </div>
          </div>

          <div className="grid gap-px bg-border lg:grid-cols-[1fr_20rem]">
            {/* Left: accounts + difficulty */}
            <div className="bg-background p-5">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Linked accounts
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {ACCOUNTS.map((a) => (
                  <li key={a.platform} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {a.platform}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">@{a.handle}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary/70"
                          style={{ width: `${a.share * 100}%` }}
                        />
                      </span>
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {a.solved}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Difficulty split
              </div>
              {/* One bar, three segments — a stacked bar states the proportions
                  of a single whole, which is what a difficulty split is. Three
                  separate bars would invite comparing them as independent
                  totals. */}
              <div className="mt-3 flex h-2 overflow-hidden rounded-full">
                {SPLIT.map((s) => (
                  <span
                    key={s.label}
                    className={s.tone}
                    style={{ width: `${(s.value / SPLIT_TOTAL) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
                {SPLIT.map((s) => (
                  <span
                    key={s.label}
                    className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
                  >
                    <span className={`size-1.5 rounded-full ${s.tone}`} aria-hidden />
                    {s.label}
                    <span className="tabular-nums text-foreground">{s.value}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Right: the calendar, the one element shared with the hero —
                intentionally, because it is the product's signature object. */}
            <div className="flex flex-col bg-background p-5">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                This term
              </div>
              <div className="my-auto pt-4">
                <ShowcaseHeatmap />
              </div>
              <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span>Current streak</span>
                <span className="tabular-nums text-foreground">18 days</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
