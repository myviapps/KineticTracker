import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { motion } from "motion/react";

/**
 * Scroll-in reveals. THE only file that imports `motion` — the landing
 * sections consume it through this module (see the re-export below), so a
 * `grep "from \"motion/react\"" src/components/landing` stays clean and the
 * motion surface of the landing page is reviewable in one place.
 *
 * Two rules, both deliberate:
 *
 * 1. Nothing above the fold may be wrapped in a Reveal. `whileInView` keeps
 *    content at `opacity: 0` until JS + the IntersectionObserver land, so the
 *    H1, subhead, primary CTA and search input must all use the pure CSS
 *    `animate-in` entrance instead. Everything Reveal wraps is below the fold
 *    (and still rendered for crawlers).
 *
 * 2. `initial` never branches on `useReducedMotion()` — the hook returns null
 *    on the server and the first client render, then flips, which would flash
 *    exactly the users who must not be flashed. `MotionConfig
 *    reducedMotion="user"` around the whole tree handles it globally.
 *
 * Staggering is done by injecting per-child delays rather than variant
 * propagation — deterministic, no orchestration subtleties, same rhythm.
 */

/** Numeric form of `--ease-glide` in styles.css, so JS and CSS feel like one. */
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function Reveal({
  children,
  className,
  delay = 0,
  y = 20,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-72px" }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

export function RevealGroup({
  children,
  className,
  stagger = 0.06,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  return (
    <div className={className}>
      {Children.map(children, (child, i) =>
        isValidElement<{ delay?: number }>(child)
          ? cloneElement(child, { delay: delay + i * stagger })
          : child,
      )}
    </div>
  );
}

/**
 * The single entry point for motion primitives on the landing page. Files that
 * need a low-level animated element (showcase cascade, leaderboard bars)
 * import from HERE, keeping `motion/react` out of every other module.
 */
export { motion, type Variants } from "motion/react";
