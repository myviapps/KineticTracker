/**
 * The cohort you were last looking at.
 *
 * The Classrooms page is a jump page, and a jump page is most useful when it
 * tells you where you currently are. Nothing in the URL can say that — by the
 * time you reach /classrooms you have left the cohort — so the id is recorded
 * on the way out and read back here.
 *
 * localStorage rather than session state on purpose: someone who lives in one
 * cohort should still see it marked after closing the tab and coming back.
 */
const KEY = "almanac-last-classroom";

export function rememberClassroom(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode / quota — the badge is a convenience, never a requirement */
  }
}

/**
 * Read-only, and NEVER called during render.
 *
 * The server cannot see localStorage, so reading this while rendering would
 * make the first client paint disagree with the server markup and React would
 * discard the tree — the same hydration mismatch the theme toggle already has
 * to work around. Callers read it in an effect instead.
 */
export function lastClassroom(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
