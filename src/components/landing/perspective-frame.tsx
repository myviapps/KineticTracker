import type { ReactNode } from "react";

/**
 * The hero's product shot: the real classroom surface, tilted back into the
 * grid field so the page opens on the product rather than on a description of
 * it.
 *
 * The tilt is CSS 3D on a wrapper, not a pre-rendered image, so the content
 * inside stays live text — it scales with the type ramp, inverts with the
 * theme, and stays selectable and legible on a phone (where the tilt is
 * dropped entirely; see below).
 *
 * `perspective` sits on the OUTER element and the rotation on the inner one.
 * Putting both on the same element makes the perspective origin follow the
 * rotated box, which flattens the effect into a plain skew.
 */
export function PerspectiveFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative mx-auto w-full max-w-5xl"
      style={{ perspective: "1800px", perspectiveOrigin: "50% 0%" }}
    >
      {/*
        The tilt is applied only from `md` up, via a CSS custom property rather
        than a Tailwind arbitrary transform, because a rotated surface on a
        375px screen costs legibility for an effect nobody can see at that size.
      */}
      <div className="lp-tilt origin-top">
        <div className="lp-panel-surface relative overflow-hidden rounded-xl">
          {/* Browser chrome. Kept minimal — three dots and a URL is enough to
              say "this is the app", and anything more competes with the data. */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-hard/70" />
              <span className="size-2.5 rounded-full bg-medium/70" />
              <span className="size-2.5 rounded-full bg-easy/70" />
            </div>
            <div className="mx-auto flex w-full max-w-sm items-center gap-2 rounded-md border border-border bg-background px-3 py-1 font-mono text-[10px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-easy" aria-hidden />
              almanac.app/classrooms/cse-a
            </div>
            <div className="w-10" aria-hidden />
          </div>

          <div className="p-4 sm:p-6">{children}</div>
        </div>
      </div>

      {/* Edge light under the frame — grounds the tilted panel in the field so
          it reads as standing in the grid rather than floating over it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 -bottom-6 h-24 opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--lp-signal) 26%, transparent), transparent 70%)",
        }}
      />
    </div>
  );
}
