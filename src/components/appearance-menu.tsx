import { useEffect, useState } from "react";
import { Check, Moon, Sun, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/components/theme-toggle";
import {
  DEFAULT_APPEARANCE,
  FONT_CHOICES,
  SCALE_CHOICES,
  applyAppearance,
  readAppearance,
  storeAppearance,
  type Appearance,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

/**
 * Theme, type face and text size.
 *
 * Replaces the standalone theme toggle everywhere it appeared — the app header,
 * the landing page and the public search page — so every role gets it, and so
 * does an anonymous visitor. There is no role gate on purpose: none of this
 * touches data, and "the text is too small to read" is not a permission level.
 *
 * Split into a body and a wrapper because the small-screen header already has
 * an overflow dropdown. Nesting a second DropdownMenu inside one of its items
 * makes Radix fight itself over focus and portals; composing the same rows
 * straight into the parent menu is both correct and less to operate.
 */
function useAppearanceState() {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  /*
    Same hydration rule as ThemeToggle, and for the same reason: the server
    cannot read localStorage, so it renders the defaults. Reading the real
    preference during render would make the first client paint disagree and
    React would discard the tree.

    Note this state does NOT drive what the page looks like — APPEARANCE_INIT in
    __root.tsx already applied that inline, before any of this mounted. It
    exists only so the menu can show which option is currently ticked.
  */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setAppearance(readAppearance());
    setMounted(true);
  }, []);

  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    applyAppearance(next);
    storeAppearance(next);
  };

  return { appearance, update, mounted };
}

/** The rows themselves, for composing directly into any DropdownMenuContent. */
export function AppearanceControls() {
  const [theme, setTheme] = useTheme();
  const { appearance, update, mounted } = useAppearanceState();

  const effectiveTheme: Theme = mounted ? theme : "dark";
  const nextTheme: Theme = effectiveTheme === "dark" ? "light" : "dark";
  const ThemeIcon = effectiveTheme === "dark" ? Sun : Moon;

  return (
    <>
      <DropdownMenuItem onSelect={() => setTheme(nextTheme)}>
        <ThemeIcon className="size-4" aria-hidden="true" />
        {nextTheme === "light" ? "Light theme" : "Dark theme"}
      </DropdownMenuItem>

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest">
        Text size
      </DropdownMenuLabel>
      {/*
        A row of buttons rather than four menu items: size is the one setting
        people try two or three of before committing, and a menu that closes on
        every pick makes comparing them tedious.
      */}
      <div className="flex gap-1 px-2 py-1.5" role="group" aria-label="Text size">
        {SCALE_CHOICES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => update({ scale: s.id })}
            aria-pressed={appearance.scale === s.id}
            title={s.label}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded border transition-colors",
              appearance.scale === s.id
                ? "border-primary bg-primary/15 font-semibold text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {/*
              Drawn AT its own scale, so the control previews what it does
              rather than describing it. Fixed px, not rem — a rem here would
              rescale with the very setting it is meant to compare against, and
              all four would look identical at every size.
            */}
            <span style={{ fontSize: `${Math.round(s.scale * 13)}px` }}>A</span>
          </button>
        ))}
      </div>

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest">
        Font
      </DropdownMenuLabel>
      {FONT_CHOICES.map((f) => (
        <DropdownMenuItem
          key={f.id}
          // Kept open: picking a face is a comparison, same as size above.
          onSelect={(e) => {
            e.preventDefault();
            update({ font: f.id });
          }}
          className="gap-2"
        >
          <Check
            className={cn("size-3.5 shrink-0", appearance.font !== f.id && "opacity-0")}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{f.label}</span>
            <span className="truncate text-3xs text-muted-foreground">{f.hint}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Standalone icon button + menu, for a header with room for it. */
export function AppearanceMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Appearance settings"
          title="Theme, font and text size"
          className="h-8 w-8"
        >
          <Type className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <AppearanceControls />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
