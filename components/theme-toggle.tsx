"use client";

import { Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The light/dark switch.
 *
 * Which side the thumb sits on is decided entirely by CSS (the `dark:`
 * variant), not by React state. The server may not know the visitor's theme —
 * with no saved choice it follows the operating system — so rendering the
 * thumb from state would mean a wrong first frame; this way there is nothing
 * to get out of step.
 *
 * Colours are relative to the surrounding text colour, so the same switch
 * works on the page and on the ink header.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const isDark =
      root.classList.contains("dark") ||
      (!root.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next: Theme = isDark ? "light" : "dark";

    root.classList.remove("light", "dark");
    root.classList.add(next);
    // Read by the root layout on the next request, so the choice survives
    // reloads and is already applied when the page arrives.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      title="Switch theme"
      className={cn(
        "focus-visible:ring-ring/50 relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border border-current/15 bg-current/5 transition-colors outline-none hover:bg-current/10 focus-visible:ring-3",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-background absolute left-1 size-6 rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-300 ease-out dark:translate-x-6 dark:ring-white/10"
      />
      <Sun
        aria-hidden
        className="text-foreground relative z-10 ml-2 size-4 transition-opacity duration-300 dark:opacity-40"
      />
      <Moon
        aria-hidden
        className="dark:text-foreground relative z-10 ml-2 size-4 opacity-40 transition-opacity duration-300 dark:opacity-100"
      />
    </button>
  );
}
