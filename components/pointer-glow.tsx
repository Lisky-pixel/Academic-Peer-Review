"use client";

import { useEffect } from "react";

/**
 * Makes the light on `[data-glow]` surfaces follow the pointer.
 *
 * One listener for the whole document, rather than one per card: it finds
 * the glowing surface under the pointer and tells it where the pointer is.
 * Mounted once, in the root layout. Does nothing for touch input or when the
 * visitor has asked for reduced motion — the CSS hides the effect there too.
 */
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) {
      return;
    }

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      // At most one update per frame, however fast the pointer reports.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const surface = (event.target as Element | null)?.closest<HTMLElement>("[data-glow]");
        if (!surface) return;
        const box = surface.getBoundingClientRect();
        surface.style.setProperty("--glow-x", `${event.clientX - box.left}px`);
        surface.style.setProperty("--glow-y", `${event.clientY - box.top}px`);
      });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
