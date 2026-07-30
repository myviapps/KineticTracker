import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Theme = "dark" | "light";
const STORAGE_KEY = "kinetic-theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.classList.toggle("light", theme === "light");
}

export function useTheme(): [Theme, (t: Theme) => void] {
  // Initialised from what the inline THEME_INIT script already stamped on <html>
  // rather than a hardcoded "dark". Previously this always started dark and only
  // corrected in an effect, so a light-mode user's toasts rendered with the dark
  // theme for a frame after hydration.
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document === "undefined"
      ? "dark"
      : document.documentElement.classList.contains("light")
        ? "light"
        : "dark",
  );
  useEffect(() => {
    const t = getStoredTheme();
    setThemeState(t);
    applyTheme(t);
  }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore quota / private-mode */
    }
  };
  return [theme, setTheme];
}

/**
 * `variant="menu"` renders a full-width labelled row instead of an icon button,
 * for use inside the small-screen overflow menu where a bare icon has no context.
 */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "menu" }) {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-sm"
      >
        <Icon className="size-4" aria-hidden="true" />
        {next === "light" ? "Light theme" : "Dark theme"}
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className="h-8 w-8"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}
