import type { StudentPlatformSummary } from "@/lib/students.functions";
import { LeetcodePanel } from "./leetcode-panel";
import { CodeforcesPanel } from "./codeforces-panel";
import { CodechefPanel } from "./codechef-panel";
import { GeeksforgeeksPanel } from "./geeksforgeeks-panel";
import { HackerrankPanel } from "./hackerrank-panel";
import { AtcoderPanel } from "./atcoder-panel";

/**
 * Which panel renders which platform.
 *
 * Bespoke per platform on purpose: a Codeforces rank title, CodeChef stars and a
 * division, a GeeksforGeeks institute rank and a HackerRank level are how each
 * community actually states standing, and flattening them into one shared tile
 * row is what made four of five platforms read as an afterthought.
 *
 * A platform with an adapter but no entry here falls through to PlatformDetail,
 * which is generic and correct — just not idiomatic. A platform with no adapter
 * never reaches this map: the route renders UnavailablePanel instead, because
 * "nothing fetched yet" is a promise the app cannot keep for those.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PanelComponent = (props: { p: StudentPlatformSummary; stats: any }) => React.ReactNode;

const PANELS: Record<string, PanelComponent> = {
  leetcode: LeetcodePanel,
  codeforces: CodeforcesPanel,
  codechef: CodechefPanel,
  geeksforgeeks: GeeksforgeeksPanel,
  hackerrank: HackerrankPanel,
  atcoder: AtcoderPanel,
  /*
    hackerearth, interviewbit, code360 and spoj have adapters but no bespoke
    panel, and deliberately so — each yields a handful of numbers, so
    PlatformDetail's generic tile row states them without inventing sections
    the platform cannot fill. They get a panel of their own if they ever start
    publishing enough to justify one.
  */
};

export function panelFor(platformId: string): PanelComponent | null {
  return PANELS[platformId] ?? null;
}
