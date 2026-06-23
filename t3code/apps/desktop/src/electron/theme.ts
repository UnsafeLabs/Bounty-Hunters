// System theme following utility
import { nativeTheme } from "electron";
import Store from "electron-store";

const store = new Store({ defaults: { theme: "system" } });

export type Theme = "light" | "dark" | "system";

export function getTheme(): Theme {
    return store.get("theme", "system") as Theme;
}

export function setTheme(theme: Theme): void {
    store.set("theme", theme);
    applyTheme(theme);
}

export function initTheme(): void {
    const theme = getTheme();
    applyTheme(theme);
    
    nativeTheme.on("updated", () => {
        if (getTheme() === "system") {
            applyTheme("system");
        }
    });
}

function applyTheme(theme: Theme): void {
    const isDark = theme === "system"
        ? nativeTheme.shouldUseDarkColors
        : theme === "dark";
    
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
}
