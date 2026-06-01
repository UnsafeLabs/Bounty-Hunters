/**
 * System theme following and real-time theme switching.
 * Supports automatic theme based on OS preference and scheduling.
 */

import { nativeTheme, BrowserWindow } from "electron";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeConfig {
  /** Default theme mode */
  defaultMode?: ThemeMode;
  /** Auto-switch at specific times */
  schedule?: {
    lightAt: string; // "07:00"
    darkAt: string;  // "19:00"
  };
}

/**
 * Theme manager with system following and scheduling.
 */
export class ThemeManager {
  private mode: ThemeMode;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private windows: Set<BrowserWindow> = new Set();

  constructor(config: ThemeConfig = {}) {
    this.mode = config.defaultMode || "system";

    // Follow system theme if in system mode
    if (this.mode === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = this.mode;
    }

    // Listen for system theme changes
    nativeTheme.on("updated", () => {
      this.notifyWindows();
    });

    // Set up schedule if configured
    if (config.schedule) {
      this.setupSchedule(config.schedule.lightAt, config.schedule.darkAt);
    }
  }

  /**
   * Register a window for theme change notifications.
   */
  registerWindow(window: BrowserWindow): void {
    this.windows.add(window);
    window.on("closed", () => this.windows.delete(window));
  }

  /**
   * Set theme mode.
   */
  setMode(mode: ThemeMode): void {
    this.mode = mode;

    if (mode === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = mode;
    }

    this.notifyWindows();
  }

  /**
   * Get current effective theme (light or dark).
   */
  getEffectiveTheme(): "light" | "dark" {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  /**
   * Toggle between light and dark.
   */
  toggle(): void {
    const current = this.getEffectiveTheme();
    this.setMode(current === "dark" ? "light" : "dark");
  }

  /**
   * Set up automatic theme scheduling.
   */
  private setupSchedule(lightAt: string, darkAt: string): void {
    const check = () => {
      const now = new Date();
      const [lightH, lightM] = lightAt.split(":").map(Number);
      const [darkH, darkM] = darkAt.split(":").map(Number);

      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const lightMinutes = lightH * 60 + lightM;
      const darkMinutes = darkH * 60 + darkM;

      if (lightMinutes < darkMinutes) {
        // Normal: light during day, dark at night
        if (currentMinutes >= lightMinutes && currentMinutes < darkMinutes) {
          nativeTheme.themeSource = "light";
        } else {
          nativeTheme.themeSource = "dark";
        }
      } else {
        // Inverted: dark during day, light at night
        if (currentMinutes >= darkMinutes && currentMinutes < lightMinutes) {
          nativeTheme.themeSource = "dark";
        } else {
          nativeTheme.themeSource = "light";
        }
      }
    };

    // Check every minute
    this.scheduleTimer = setInterval(check, 60000);
    check(); // Initial check
  }

  /**
   * Notify all registered windows of theme change.
   */
  private notifyWindows(): void {
    const theme = this.getEffectiveTheme();
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send("theme-changed", theme);
      }
    }
  }

  /**
   * Cleanup.
   */
  destroy(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }
  }
}
