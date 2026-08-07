import { Link } from "@tanstack/react-router";
import { LogIn, LayoutDashboard } from "lucide-react";

import { useRole } from "@/hooks/use-role";
import { AlmanacLogo } from "@/components/almanac-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#showcase", label: "Showcase" },
  { href: "#roles", label: "For your team" },
  { href: "#faq", label: "FAQ" },
] as const;

/** Sticky marketing nav — anchor links, theme toggle, /search, auth-aware CTA. */
export function LandingHeader() {
  const { user, isLoading } = useRole();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Almanac home">
          <AlmanacLogo size={28} />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Landing sections">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/search">Search</Link>
          </Button>
          {isLoading ? (
            <Skeleton className="h-8 w-28" />
          ) : user ? (
            <Button asChild variant="default" size="sm">
              <Link to="/dashboard">
                <LayoutDashboard className="size-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="/auth">
                <LogIn className="size-4" />
                <span className="hidden sm:inline">Staff sign in</span>
                <span className="sm:hidden">Sign in</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
