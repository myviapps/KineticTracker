import { useEffect, useRef, useState } from "react";

/**
 * Eases a number toward its target instead of snapping to it.
 *
 * The refresh job polls every 2 seconds, so a raw counter jumps in visible
 * steps — 0, then 12, then 31 — which reads as stalled-then-lurching rather
 * than as work in progress. Tweening between polls makes the same data feel
 * continuous without inventing any: the value always lands exactly on the real
 * one, it just takes ~400ms to get there.
 *
 * Respects prefers-reduced-motion by assigning the target directly. Checked on
 * every run rather than cached, because the OS setting can change while the
 * page is open.
 */
export function useAnimatedNumber(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced || durationMs <= 0) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    // easeOutCubic — fast to begin with, so the number responds immediately,
    // then settles rather than overshooting.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (target - from) * ease(t);
      // Round on the way, land exactly on the target at the end — a tween that
      // finishes at 139.7 of 140 would leave the UI permanently one short.
      setValue(t === 1 ? target : Math.round(next));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Hand the next tween the value actually on screen, so an interrupted
      // animation continues from where it stopped instead of snapping back.
      fromRef.current = value;
      frameRef.current = null;
    };
    // `value` is deliberately not a dependency — including it would restart the
    // animation on every frame it sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
