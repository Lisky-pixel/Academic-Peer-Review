/**
 * The light/dark choice.
 *
 * Stored in a cookie rather than localStorage so the server can render the
 * right class on <html> in the very first response. That is what avoids a
 * flash of the wrong theme without an inline script. With no cookie there is
 * no class, and CSS follows the operating system.
 *
 * Not a secret and not httpOnly: the switch in the browser writes it.
 */
export const THEME_COOKIE = "reviewflow-theme";

export type Theme = "light" | "dark";

/** Anything other than the two known values means "no choice made". */
export function parseTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}
