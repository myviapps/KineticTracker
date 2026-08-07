import { useEffect, useRef } from "react";

/**
 * The page's signature: a two-scale lattice with lit heatmap cells scattered
 * through it, so the landing page is built ON the same grid the product's data
 * lives in rather than on a decorative texture.
 *
 * Three layers, back to front:
 *
 *   1. `.lp-lattice`  — 14px hairline cells, the module the logo is drawn on
 *   2. `.lp-module`   — 56px heavier rules, 4x the cell (the logo's own ratio).
 *                       One scale alone reads as graph paper; two read as a
 *                       measured surface.
 *   3. lit cells      — a sparse set of filled squares at the logo's four
 *                       discrete opacities, breathing on the diagonal
 *
 * The cells are deliberately NOT random per render. `intensity()` is seeded, so
 * SSR and hydration produce identical markup — `Math.random()` here would mean
 * a different field on the server than on the client and React would warn on
 * every load.
 *
 * Everything is `aria-hidden` and `pointer-events-none`; it is atmosphere and
 * must never take focus or intercept a click on the content above it.
 */

/** Cells across/down the field. Kept modest — this is atmosphere, not a chart. */
const COLS = 44;
const ROWS = 16;

/** The logo's four steps. A continuous ramp would read as a glow, not as data. */
const STEPS = [0, 0.34, 0.66, 1];

/**
 * Deterministic intensity 0-3, seeded per cell.
 *
 * Weighted so most cells are dark: a field where half the cells are lit stops
 * looking like activity and starts looking like a checkerboard. Density also
 * climbs to the right, the same direction the logo's does, so the field carries
 * the same "a cohort improving over a term" reading as the mark.
 */
function intensity(col: number, row: number): number {
  /*
    A proper avalanche hash, not `(col*a + row*b) % n`.

    The linear form is the obvious thing to write and it is visibly wrong here:
    a weighted sum of the coordinates stays correlated along diagonals, so the
    field rendered as regular diagonal stripes — a moiré artifact that reads as
    a rendering bug rather than as activity. Mixing with shifts and multiplies
    (Math.imul keeps it in 32-bit, since plain `*` would lose precision and
    reintroduce structure) decorrelates neighbours, which is what makes the
    scatter look like data.
  */
  let x = Math.imul(col + 1, 374761393) ^ Math.imul(row + 1, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  const h = ((x ^ (x >>> 16)) >>> 0) % 100;

  const bias = (col / COLS) * 14; // right-hand side is denser
  const v = h + bias;
  // ~11% of cells light, and only 2% reach full. The first pass lit ~26% and
  // the hero became unreadable — the field read as the subject instead of as
  // the surface the subject sits on. This is atmosphere; the headline is the
  // thing being looked at.
  if (v < 89) return 0;
  if (v < 96) return 1;
  if (v < 99) return 2;
  return 3;
}

export function SignalField({ spotlight = true }: { spotlight?: boolean } = {}) {
  return (
    /*
      BOUNDED HEIGHT, not `inset-0`.

      The field mounts on the full-page shell, so `inset-0` made it as tall as
      the document (~6000px) — and every mask stop here is a PERCENTAGE, so
      "fade out by 85%" became "fade out 5000px down". Cells rendered behind the
      features, the profile, the FAQ and the footer, which is both noisy and the
      opposite of the intent: this is the surface the page opens on, not a
      texture the reader drags around all day.

      140vh keeps it through the hero and just into the rail, then it is gone.
    */
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[140vh] overflow-hidden"
    >
      <div className="lp-lattice absolute inset-0" />
      <div className="lp-module absolute inset-0" />
      <LitCells />
      <div className="landing-glow absolute inset-0 animate-glow-pulse" />
      {spotlight && <PointerSpotlight />}
    </div>
  );
}

/**
 * The lit cells, as ONE tiling SVG pattern.
 *
 * The obvious implementation — a viewBox of `COLS ROWS` with
 * `preserveAspectRatio="none"` — is wrong, and visibly so: it stretches the
 * grid to whatever the section measures, so at 1440x2000 each "cell" rendered
 * as a 32px-wide, 125px-tall bar. The field looked like a barcode.
 *
 * `patternUnits="userSpaceOnUse"` with an explicit pixel tile is what keeps a
 * cell square and exactly `CELL` px at every viewport, which is the only way it
 * stays in phase with the CSS lattice behind it. The tile is the full 44x16
 * field (616x224px), large enough that the repeat is not legible under the
 * mask, and it costs one DOM node instead of ~700.
 */
const CELL = 14;

function LitCells() {
  const cells: { c: number; r: number; step: number }[] = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const step = intensity(c, r);
      if (step > 0) cells.push({ c, r, step });
    }
  }

  return (
    <svg
      className="lp-cells absolute inset-0 size-full"
      style={{
        /*
          Two masks intersected, which is what keeps the hero readable:

            1. a radial hole punched where the copy sits, so no cell ever sits
               behind the headline, subhead or search box
            2. a downward fade, so the field belongs to the top of the page and
               does not follow the reader into the content

          A single top-anchored radial (the first attempt) satisfied neither —
          it was densest exactly where the H1 is.
        */
        maskImage:
          "radial-gradient(ellipse 66% 50% at 50% 40%, transparent 34%, #000 84%), linear-gradient(to bottom, #000 0%, #000 45%, transparent 85%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 66% 50% at 50% 40%, transparent 34%, #000 84%), linear-gradient(to bottom, #000 0%, #000 45%, transparent 85%)",
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <defs>
        <pattern
          id="lp-signal-cells"
          width={COLS * CELL}
          height={ROWS * CELL}
          patternUnits="userSpaceOnUse"
        >
          {cells.map(({ c, r, step }) => (
            <rect
              key={`${c}-${r}`}
              x={c * CELL + 2}
              y={r * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={2}
              fill="var(--lp-signal)"
              opacity={STEPS[step]}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#lp-signal-cells)" />
    </svg>
  );
}

/**
 * Cursor-following wash.
 *
 * Writes a CSS custom property through a ref rather than going through React
 * state. The previous version called setState on every `pointermove`, which is
 * a full re-render per mouse move for a purely decorative effect.
 *
 * Reduced motion is checked with a bare `matchMedia` so this file stays free of
 * the motion library, matching the convention the old grid-backdrop used.
 */
function PointerSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      // Coalesce to one write per frame; pointermove can fire far faster than
      // the compositor can use.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", `${e.clientX - r.left}px`);
        el.style.setProperty("--y", `${e.clientY - r.top}px`);
        el.style.opacity = "1";
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="absolute inset-0 opacity-0 transition-opacity duration-menu"
      style={{
        background:
          "radial-gradient(520px circle at var(--x, 50%) var(--y, 0px), color-mix(in oklab, var(--lp-signal) 7%, transparent), transparent 62%)",
      }}
    />
  );
}
