import { AlmanacLogo } from "@/components/almanac-logo";
import { cn } from "@/lib/utils";

interface AnimatedLoaderProps {
  className?: string;
  text?: string;
  /**
   * Fills the viewport. Only correct outside the app shell (root shell, auth) —
   * inside `<main>` the loader must fill the content area instead, or the nav
   * bar and sidebar get pushed off-screen while a route loads.
   */
  fullscreen?: boolean;
}

/** The single loading animation for the app: the Almanac heatmap filling in. */
export function AnimatedLoader({ className, text, fullscreen = false }: AnimatedLoaderProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-5 px-4",
        fullscreen ? "min-h-screen bg-background" : "min-h-[60vh]",
        className,
      )}
    >
      <AlmanacLogo size={64} animated showText={false} />
      {text && (
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
}
