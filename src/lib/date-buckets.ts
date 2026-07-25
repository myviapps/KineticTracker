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
