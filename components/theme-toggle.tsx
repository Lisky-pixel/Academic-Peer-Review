"use client";

import { Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * The light/dark switch.
 *
 * Which side the thumb sits on is decided entirely by CSS (the `dark:`
 * variant), not by React state. The server may not know the visitor's theme —
 * with no saved choice it follows the operating system — so rendering the
 * thumb from state would mean a wrong first frame; this way there is nothing
 * to get out of step.
 *
 * The change itself is animated: the new theme spreads out as a circle from
 * the switch, using the browser's View Transitions. Where those are not
 * available, or the visitor prefers reduced motion, it simply changes.
 *
 * Colours are relative to the surrounding text colour, so the same switch
 * works on the page and on the ink header.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const isDark =
      root.classList.contains("dark") ||
      (!root.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
    const next: Theme = isDark ? "light" : "dark";

    const apply = () => {
      root.classList.remove("light", "dark");
      root.classList.add(next);
      // Read by the root layout on the next request, so the choice survives
      // reloads and is already applied when the page arrives.
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    };

    const transitions = document as TransitionDocument;
    if (
      !transitions.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      apply();
      return;
    }

    // Grow from where the switch was pressed. A keyboard press reports no
    // position, so fall back to the middle of the button.
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || box.left + box.width / 2;
    const y = event.clientY || box.top + box.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    root.style.setProperty("--vt-x", `${x}px`);
    root.style.setProperty("--vt-y", `${y}px`);
    root.style.setProperty("--vt-r", `${radius}px`);
    root.classList.add("theme-switching");

    transitions
      .startViewTransition(apply)
      .finished.catch(() => undefined)
      .finally(() => root.classList.remove("theme-switching"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      title="Switch theme"
      className={cn(
        "group/toggle focus-visible:ring-ring/50 relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border border-current/15 bg-current/5 transition-colors outline-none hover:bg-current/10 focus-visible:ring-3 active:scale-95",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-background absolute left-1 size-6 rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none dark:translate-x-6 dark:ring-white/10"
      />
      <Sun
        aria-hidden
        className="text-foreground relative z-10 ml-2 size-4 transition-all duration-500 motion-reduce:transition-none dark:scale-75 dark:-rotate-90 dark:opacity-40"
      />
      <Moon
        aria-hidden
        className="dark:text-foreground relative z-10 ml-2 size-4 scale-75 rotate-90 opacity-40 transition-all duration-500 motion-reduce:transition-none dark:scale-100 dark:rotate-0 dark:opacity-100"
      />
    </button>
  );
}
