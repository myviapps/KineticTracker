/**
 * Reading preferences: type face and text size.
 *
 * Sits beside the theme rather than inside it, because the two answer different
 * questions — theme is "which palette", appearance is "can I read this". They
 * share a delivery mechanism though: both are stamped onto <html> by an inline
 * script before first paint (see APPEARANCE_INIT in routes/__root.tsx), because
 * applying them in an effect means one frame of the wrong size on every load.
 *
 * localStorage rather than a column on the user: this is a property of the
 * screen someone is reading on, not of their account. The same person on a
 * 27-inch monitor and a laptop wants different answers, and a server-side
 * setting would follow them between the two and be wrong on one.
 */

const FONT_KEY = "almanac-font";
const SCALE_KEY = "almanac-font-scale";

/** Faces are defined in styles.css under `:root[data-font="…"]`. */
export const FONT_CHOICES = [
  {
    id: "default",
    label: "Inter",
    hint: "The product's own face",
  },
  {
    id: "system",
    label: "System",
    hint: "No webfont — fastest, native",
  },
  {
    id: "hyperlegible",
    label: "Hyperlegible",
    hint: "Drawn for low-vision reading",
  },
] as const;

export type FontChoice = (typeof FONT_CHOICES)[number]["id"];

/**
 * Multipliers on the browser's own default size, not absolute pixel sizes.
 *
 * Kept to four steps and a modest range. Everything in the interface is in rem,
 * so these rescale layout as well as glyphs — past ~1.25 a fifteen-column table
 * stops fitting a laptop, and an option that visibly breaks a page is worse
 * than not offering it.
 */
export const SCALE_CHOICES = [
  { id: "sm", label: "Compact", scale: 0.9 },
  { id: "md", label: "Default", scale: 1 },
  { id: "lg", label: "Large", scale: 1.1 },
  { id: "xl", label: "Larger", scale: 1.25 },
] as const;

export type ScaleChoice = (typeof SCALE_CHOICES)[number]["id"];

export type Appearance = { font: FontChoice; scale: ScaleChoice };

export const DEFAULT_APPEARANCE: Appearance = { font: "default", scale: "md" };

function isFont(v: unknown): v is FontChoice {
  return FONT_CHOICES.some((f) => f.id === v);
}
function isScale(v: unknown): v is ScaleChoice {
  return SCALE_CHOICES.some((s) => s.id === v);
}

export function scaleValue(id: ScaleChoice): number {
  return SCALE_CHOICES.find((s) => s.id === id)?.scale ?? 1;
}

/**
 * Read-only, and NEVER called during render.
 *
 * The server cannot see localStorage, so reading it while rendering makes the
 * first client paint disagree with the server markup and React discards the
 * tree — the same rule lastClassroom() and the column preference follow. The
 * inline script handles the pre-paint case; components read this in an effect.
 */
export function readAppearance(): Appearance {
  try {
    const font = window.localStorage.getItem(FONT_KEY);
    const scale = window.localStorage.getItem(SCALE_KEY);
    return {
      font: isFont(font) ? font : DEFAULT_APPEARANCE.font,
      scale: isScale(scale) ? scale : DEFAULT_APPEARANCE.scale,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Write the preference to <html>. Mirrors what APPEARANCE_INIT does inline, so
 * a change takes effect immediately instead of on the next load.
 *
 * `default` clears the attribute rather than setting data-font="default": the
 * base :root block already holds those faces, and an attribute that selects
 * nothing is one more state to reason about.
 */
export function applyAppearance(a: Appearance): void {
  const el = document.documentElement;
  if (a.font === "default") el.removeAttribute("data-font");
  else el.setAttribute("data-font", a.font);
  el.style.setProperty("--app-font-scale", String(scaleValue(a.scale)));
}

export function storeAppearance(a: Appearance): void {
  try {
    window.localStorage.setItem(FONT_KEY, a.font);
    window.localStorage.setItem(SCALE_KEY, a.scale);
  } catch {
    /* private mode / quota — a reading preference is never worth failing over */
  }
}
