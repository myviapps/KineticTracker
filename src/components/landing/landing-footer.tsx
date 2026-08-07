import { Link } from "@tanstack/react-router";

import { AlmanacLogo } from "@/components/almanac-logo";
import { Separator } from "@/components/ui/separator";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#showcase", label: "Showcase" },
  { href: "#roles", label: "For your team" },
  { href: "#faq", label: "FAQ" },
] as const;

export function LandingFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 sm:flex-row sm:justify-between sm:px-6">
        <Link to="/" aria-label="Almanac home">
          <AlmanacLogo size={28} />
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-5" aria-label="Footer">
          {NAV.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
          <Link
            to="/search"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Student lookup
          </Link>
        </nav>
      </div>
      <Separator />
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6">
        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60 sm:text-left">
          Almanac · progress tracking for placement teams
        </p>
      </div>
    </footer>
  );
}
