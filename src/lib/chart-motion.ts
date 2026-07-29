/**
 * Shared Recharts motion.
 *
 * Recharts defaults to `animationDuration: 1500` with `animationEasing: "ease"`,
 * and it replays the whole animation every time the data reference changes —
 * which, while a refresh job is running, is every few seconds. A 1.5s ease
 * re-draw on that cadence is the chart equivalent of a page flicker.
 *
 * Matches the CSS motion system in styles.css: quick attack, decelerating
 * settle. Spread onto every <Line>, <Bar> and <Pie> so charts move as one.
 */
export const CHART_MOTION = {
  isAnimationActive: true,
  animationDuration: 520,
  animationEasing: "ease-out",
} as const;

/**
 * For charts that update while data is streaming in. Skips the re-draw so the
 * series updates in place instead of replaying from zero on every poll.
 */
export const CHART_MOTION_STATIC = {
  isAnimationActive: false,
} as const;
