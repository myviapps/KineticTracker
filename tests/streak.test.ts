import { describe, expect, it } from "vitest";

import { currentStreak, longestStreakBetween, streakEndingOn } from "@/lib/date-buckets";

/**
 * The streak used to be LeetCode's own `userCalendar(year).streak`, copied
 * through verbatim. These cases are the three reasons that was replaced:
 * the year boundary, the "today isn't over yet" morning, and decay.
 */

/** Unix-second key for a UTC calendar day, the shape LeetCode publishes. */
function key(iso: string): string {
  return String(Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000));
}

/** A calendar with one submission on each of the given days. */
function calendar(...days: string[]): Record<string, number> {
  return Object.fromEntries(days.map((d) => [key(d), 1]));
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("currentStreak", () => {
  it("counts consecutive days ending today", () => {
    const cal = calendar("2026-08-20", "2026-08-21", "2026-08-22");
    expect(currentStreak(cal, at("2026-08-22"))).toBe(3);
  });

  it("still counts when today is empty but yesterday is not", () => {
    // The UTC day is in progress. Zeroing a live streak at 00:01 because the
    // student has not submitted YET would be wrong every morning.
    const cal = calendar("2026-08-20", "2026-08-21");
    expect(currentStreak(cal, at("2026-08-22"))).toBe(2);
  });

  it("stops at the first gap", () => {
    const cal = calendar("2026-08-18", "2026-08-20", "2026-08-21", "2026-08-22");
    expect(currentStreak(cal, at("2026-08-22"))).toBe(3);
  });

  it("decays to zero once the last active day is older than yesterday", () => {
    // The whole reason this is derived rather than stored: a student scraped
    // three days ago and quiet since must read 0, not their scraped value.
    const cal = calendar("2026-08-17", "2026-08-18", "2026-08-19");
    expect(currentStreak(cal, at("2026-08-22"))).toBe(0);
  });

  it("survives the New Year boundary", () => {
    // LeetCode's own number cannot do this: userCalendar(year: 2026) knows
    // nothing about December 2025, so it reported 2 where the truth is 5.
    const cal = calendar("2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02");
    expect(currentStreak(cal, at("2026-01-02"))).toBe(5);
  });

  it("is zero for an empty calendar", () => {
    expect(currentStreak({}, at("2026-08-22"))).toBe(0);
  });

  it("ignores days recorded as zero submissions", () => {
    const cal = { ...calendar("2026-08-21", "2026-08-22"), [key("2026-08-20")]: 0 };
    expect(currentStreak(cal, at("2026-08-22"))).toBe(2);
  });
});

describe("streakEndingOn", () => {
  it("counts back from the given day, inclusive", () => {
    const cal = calendar("2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14");
    expect(streakEndingOn(cal, at("2026-03-13"))).toBe(3);
  });

  it("is 0 when the day itself is idle — no grace for a finished day", () => {
    // currentStreak() falls back to yesterday because today is still in
    // progress. A date in the past is over, so the same rule would be a lie.
    const cal = calendar("2026-03-11", "2026-03-12");
    expect(streakEndingOn(cal, at("2026-03-13"))).toBe(0);
  });

  it("answers the two boundary questions the Streak Matrix asks", () => {
    const cal = calendar("2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13");
    const x = at("2026-03-13");
    // Into X: the run they carried INTO the day, X excluded.
    expect(streakEndingOn(cal, new Date("2026-03-12T12:00:00Z"))).toBe(3);
    // Through X: X included.
    expect(streakEndingOn(cal, x)).toBe(4);
  });

  it("crosses the year boundary", () => {
    const cal = calendar("2025-12-30", "2025-12-31", "2026-01-01");
    expect(streakEndingOn(cal, at("2026-01-01"))).toBe(3);
  });
});

describe("longestStreakBetween", () => {
  it("finds the longest run inside the window", () => {
    const cal = calendar("2026-03-01", "2026-03-02", "2026-03-03", "2026-03-06", "2026-03-07");
    expect(longestStreakBetween(cal, at("2026-03-01"), at("2026-03-07"))).toBe(3);
  });

  it("clips a run that started before the window", () => {
    // The run is really 5 days, but only 2 of them are in range — the question
    // is "how did they do over THIS range".
    const cal = calendar("2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02");
    expect(longestStreakBetween(cal, at("2026-03-01"), at("2026-03-05"))).toBe(2);
  });

  it("is 0 for a window with no activity", () => {
    expect(longestStreakBetween(calendar("2026-01-01"), at("2026-03-01"), at("2026-03-05"))).toBe(
      0,
    );
  });

  it("handles a single-day window", () => {
    const cal = calendar("2026-03-03");
    expect(longestStreakBetween(cal, at("2026-03-03"), at("2026-03-03"))).toBe(1);
  });
});
