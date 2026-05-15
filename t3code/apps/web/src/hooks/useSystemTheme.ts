import { useCallback, useSyncExternalStore } from "react";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const SERVER_SNAPSHOT = { theme: "light" as const, isSystem: true as const };

type SystemTheme = "light" | "dark";
export type SystemThemeSnapshot = {
  theme: SystemTheme;
  isSystem: boolean;
};

function getSystemTheme(): SystemTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function subscribeToSystemTheme(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const mql = window.matchMedia(MEDIA_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * Detects the system color scheme preference via `prefers-color-scheme` media query.
 * Listens for real-time changes and returns the current system theme.
 *
 * @returns {SystemThemeSnapshot} An object with:
 *   - `theme`: The current system color scheme (`"light"` or `"dark"`)
 *   - `isSystem`: Always `true` since this hook strictly follows the system preference
 */
export function useSystemTheme(): SystemThemeSnapshot {
  const getSnapshot = useCallback((): SystemThemeSnapshot => {
    return { theme: getSystemTheme(), isSystem: true };
  }, []);

  const theme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );

  return theme;
}
