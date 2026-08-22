/**
 * Which optional columns the cohort LeetCode table shows.
 *
 * Total/Easy/Medium/Hard/Today/Streak/Class/College/Contests are the spine and
 * are never hidden. Yesterday, Week and 30d are movement windows: useful when
 * you are chasing activity, pure noise when you are reading standings, and
 * between them they are three of the fifteen columns that make this table need
 * a horizontal scrollbar on a laptop.
 *
 * localStorage rather than the URL: this is a preference about how someone
 * likes to read a table, not a description of what the page is showing. Putting
 * it in the address bar would attach it to every shared link and inflict one
 * person's layout on whoever opens it.
 */
const KEY = "almanac-cohort-columns";

/** The optional ones, in table order. */
export const OPTIONAL_COLUMNS = [
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Week" },
  { id: "month", label: "30 days" },
] as const;

export type OptionalColumnId = (typeof OPTIONAL_COLUMNS)[number]["id"];
export type ColumnVisibility = Record<OptionalColumnId, boolean>;

/** Everything on — what the table did before it was configurable. */
export const ALL_COLUMNS_VISIBLE: ColumnVisibility = {
  yesterday: true,
  week: true,
  month: true,
};

/**
 * Read-only, and NEVER called during render — same rule as lastClassroom().
 *
 * The server cannot see localStorage, so reading it while rendering would make
 * the first client paint disagree with the server markup and React would throw
 * the tree away. Callers read it in an effect and start from
 * ALL_COLUMNS_VISIBLE, so the pre-hydration table is the complete one.
 */
export function readColumnVisibility(): ColumnVisibility {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return ALL_COLUMNS_VISIBLE;
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
    // Rebuilt key by key rather than spread: a stored blob from an older
    // version with a since-removed column must not survive into the state.
    return OPTIONAL_COLUMNS.reduce((acc, c) => {
      acc[c.id] = saved[c.id] !== false;
      return acc;
    }, {} as ColumnVisibility);
  } catch {
    return ALL_COLUMNS_VISIBLE;
  }
}

export function writeColumnVisibility(v: ColumnVisibility): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode / quota — a column preference is never worth failing over */
  }
}
