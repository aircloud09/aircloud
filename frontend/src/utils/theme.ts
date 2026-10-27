/**
 * The light and dark themes (docs/plan/spec.md 「어두운 테마」). The chosen
 * theme is saved as the ``theme`` preference and mirrored in localStorage, so
 * a page opened in dark mode does not flash light before preferences load.
 * Not a client module: the root layout inlines THEME_INIT_SCRIPT.
 */

export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

export const DEFAULT_THEME: Theme = "light";

/** The class on <html> that switches Tailwind's ``dark:`` variants on. */
export const DARK_CLASS = "dark";

const THEME_STORAGE_KEY = "agent-office-theme";

export function isTheme(value: unknown): value is Theme {
  return themes.includes(value as Theme);
}

/** The theme this browser last used, or null when none is stored. */
export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    // localStorage may be unavailable (private mode).
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors; the preference on the backend still holds it.
  }
}

/** Runs before the page paints: puts the stored dark theme on <html>. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark")document.documentElement.classList.add(${JSON.stringify(
  DARK_CLASS,
)})}catch(e){}`;
