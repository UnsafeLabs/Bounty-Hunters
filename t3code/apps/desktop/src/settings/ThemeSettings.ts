/**
 * Theme settings exposing light, dark, and system options.
 * Persists the theme choice via electron-store through IPC.
 */

export const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", description: "Always use light mode" },
  { value: "dark" as const, label: "Dark", description: "Always use dark mode" },
  { value: "system" as const, label: "System", description: "Follow OS preference" },
] as const;

export type ThemeOption = (typeof THEME_OPTIONS)[number]["value"];
