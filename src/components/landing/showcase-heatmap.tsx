import { motion } from "@/components/landing/reveal";
import { cellClass } from "@/components/heatmap";

/**
 * Mock submission heatmap for the showcase — ~26×7 deterministic cells, using
 * the real product's `cellClass` so the mock stays in lockstep with the actual
 * heatmap instead of copy-pasting five intensity classes that go stale.
 *
 * Each cell cascades in along the same diagonal the real `.almanac-day` wave
 * uses (`delay: (row + col) * 0.012`). The cascade runs through one container's
 * `whileInView` variant orchestration. MotionConfig reducedMotion="user"
 * up at index.tsx collapses the opacity animations to an instant apply, so a
 * reduced-motion user gets the full grid immediately — nothing sticks
 * invisible.
 */
const WEEKS = 26;

/** Deterministic pseudo-random intensity 0-4, seeded per cell. */
function intensity(w: number, d: number): number {
  const h = (w * 31 + d * 17 + 7) % 29;
  if (h < 12) return 0;
  if (h < 19) return 1;
  if (h < 24) return 2;
  if (h < 27) return 3;
  return 4;
}

export function ShowcaseHeatmap() {
  return (
    <motion.div
      className="flex flex-col gap-[3px]"
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      {Array.from({ length: 7 }, (_, d) => (
        <div key={d} className="flex gap-[3px]">
          {Array.from({ length: WEEKS }, (_, w) => {
            const b = intensity(w, d);
            return (
              /*
                `flex-1 aspect-square`, not the fixed `size-3` this used to be.
                At 12px a cell the grid measured 387x102, sitting in the top-left
                of a panel roughly 700px wide and 250px tall — the mock read as
                broken rather than sparse, and the dead area below it was the
                most obvious hole on the page. Flexible cells make the grid span
                its column and grow to match, which is also how the real
                heatmap behaves.
              */
              <motion.div
                key={w}
                className={`aspect-square flex-1 rounded-[2px] ${cellClass(b)}`}
                variants={{
                  hidden: { opacity: 0 },
                  visible: { opacity: 1, transition: { delay: (w + d) * 0.012, duration: 0.3 } },
                }}
              />
            );
          })}
        </div>
      ))}
    </motion.div>
  );
}
