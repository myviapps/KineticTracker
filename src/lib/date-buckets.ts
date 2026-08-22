// Client + server safe helpers to bucket the LeetCode submission calendar.
export type CalendarMap = Record<string, number>;

function utcDay(d: Date): number {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return Math.floor(c.getTime() / 1000);
}

export function todayCount(cal: CalendarMap, ref: Date = new Date()): number {
  return cal[String(utcDay(ref))] ?? 0;
}

export function yesterdayCount(cal: CalendarMap, ref: Date = new Date()): number {
  const y = new Date(ref);
  y.setUTCDate(y.getUTCDate() - 1);
  return cal[String(utcDay(y))] ?? 0;
}

export function lastNDaysCount(cal: CalendarMap, n: number, ref: Date = new Date()): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(ref);
    d.setUTCDate(d.getUTCDate() - i);
    s += cal[String(utcDay(d))] ?? 0;
  }
  return s;
}

export function thisWeekCount(cal: CalendarMap, ref: Date = new Date()): number {
  // Monday-start week
  const d = new Date(ref);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dow);
  let s = 0;
  for (let i = 0; i <= dow; i++) {
    const cur = new Date(start);
    cur.setUTCDate(start.getUTCDate() + i);
    s += cal[String(utcDay(cur))] ?? 0;
  }
  return s;
}

export function thisMonthCount(cal: CalendarMap, ref: Date = new Date()): number {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  let s = 0;
  for (const [k, v] of Object.entries(cal)) {
    const dt = new Date(Number(k) * 1000);
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m) s += v;
  }
  return s;
}

export function thisYearCount(cal: CalendarMap, ref: Date = new Date()): number {
  const y = ref.getUTCFullYear();
  let s = 0;
  for (const [k, v] of Object.entries(cal)) {
    const dt = new Date(Number(k) * 1000);
    if (dt.getUTCFullYear() === y) s += v;
  }
  return s;
}

/** Midnight UTC on the day `d` falls in. */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function shiftDays(d: Date, n: number): Date {
  const c = utcMidnight(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

/** Submissions recorded on the UTC day `d` falls in. */
export function dayCount(cal: CalendarMap, d: Date): number {
  return cal[String(utcDay(d))] ?? 0;
}

/**
 * Consecutive active days ending ON `day`, inclusive. 0 if `day` itself is idle.
 *
 * The primitive every streak figure in the app is built from, so "streak" means
 * one thing whether it is asked about today or about a date last March.
 */
export function streakEndingOn(cal: CalendarMap, day: Date): number {
  const cursor = utcMidnight(day);
  let n = 0;
  while (dayCount(cal, cursor) > 0) {
    n += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return n;
}

/**
 * Consecutive days, ending today, with at least one submission.
 *
 * The app used to render LeetCode's own `userCalendar(year).streak` verbatim.
 * That number is scoped to ONE CALENDAR YEAR, so every streak crossing New Year
 * reset to 0 on 1 Jan; it was also written as `0` whenever the calendar call was
 * skipped, silently wiping a real streak. Deriving it here from the calendar we
 * already store fixes both, and adds a third property a stored integer cannot
 * have: it DECAYS. A student scraped three days ago and quiet since reads 0d,
 * not the 10d that was true when the scrape ran.
 *
 * Falls back to YESTERDAY when today is empty — the current UTC day is still in
 * progress, and resetting a 30-day streak at 00:01 UTC because nothing has been
 * submitted yet today would be wrong every single morning. That grace is
 * specific to "now": streakEndingOn() has no such rule, because a past date is
 * a finished day and there is nothing left to wait for.
 *
 * Counts DAYS WITH A SUBMISSION, retries included, which is what every other
 * count derived from this calendar means (see the note in buckets.ts).
 */
export function currentStreak(cal: CalendarMap, ref: Date = new Date()): number {
  const today = utcMidnight(ref);
  if (dayCount(cal, today) > 0) return streakEndingOn(cal, today);
  return streakEndingOn(cal, shiftDays(today, -1));
}

/**
 * Longest run of consecutive active days within [from, to] inclusive.
 *
 * Clipped to the window on purpose: a run that started before `from` is
 * reported only for the part that falls inside it, because the question the
 * Streak Matrix asks is "how did they do over THIS range".
 */
export function longestStreakBetween(cal: CalendarMap, from: Date, to: Date): number {
  let best = 0;
  let run = 0;
  const cursor = utcMidnight(from);
  const end = utcMidnight(to);
  while (cursor <= end) {
    run = dayCount(cal, cursor) > 0 ? run + 1 : 0;
    if (run > best) best = run;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return best;
}

// Build a 371-cell (53 weeks * 7 days) heatmap grid ending today.
export function buildHeatmapGrid(cal: CalendarMap, ref: Date = new Date()) {
  const weeks: { date: Date; count: number }[][] = [];
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  // Align to Sunday end-of-week
  const endDow = end.getUTCDay(); // 0=Sun
  const gridEnd = new Date(end);
  gridEnd.setUTCDate(end.getUTCDate() + (6 - endDow));

  for (let w = 52; w >= 0; w--) {
    const col: { date: Date; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(gridEnd);
      day.setUTCDate(gridEnd.getUTCDate() - (w * 7 + (6 - d)));
      col.push({ date: day, count: cal[String(utcDay(day))] ?? 0 });
    }
    weeks.push(col);
  }
  return weeks;
}
