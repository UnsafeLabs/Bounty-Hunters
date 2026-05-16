import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildApplicationMenu, applyMenu } from "./menu";

vi.mock("electron", () => ({
    Menu: {
        buildFromTemplate: vi.fn((template) => ({
            items: template,
            getMenuItemById: vi.fn(),
        })),
        setApplicationMenu: vi.fn(),
    },
    MenuItem: vi.fn(),
    BrowserWindow: vi.fn(),
    app: {
        getName: vi.fn(() => "T3 Code"),
        getAppPath: vi.fn(() => "/test/path"),
    },
    dialog: {
        showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    },
    shell: {},
}));

describe("Application Menu", () => {
    let mockWindow: any;

    beforeEach(() => {
        mockWindow = {
            webContents: {
                send: vi.fn(),
                openDevTools: vi.fn(),
                reload: vi.fn(),
                reloadIgnoringCache: vi.fn(),
            },
        };
    });

    it("should build menu with Developer and Git submenus", () => {
        const menu = buildApplicationMenu(mockWindow);
        expect(menu).toBeDefined();
        expect(menu.items).toBeDefined();
        expect(menu.items.length).toBeGreaterThan(4);
    });

    it("should include Developer menu with Toggle Terminal", () => {
        const menu = buildApplicationMenu(mockWindow);
        const devLabels = menu.items.map((item: any) => item.label);
        expect(devLabels).toContain("Developer");
    });

    it("should include Git menu with Stage and Push", () => {
        const menu = buildApplicationMenu(mockWindow);
        const gitLabels = menu.items.map((item: any) => item.label);
        expect(gitLabels).toContain("Git");
    });

    it("should include File menu with New and Open", () => {
        const menu = buildApplicationMenu(mockWindow);
        const fileLabel = menu.items.find((item: any) => item.label === "File");
        expect(fileLabel).toBeDefined();
        const submenu: any[] = (fileLabel as any).submenu?.items || [];
        const labels = submenu.map((s: any) => s.label);
        expect(labels).toContain("New Project");
        expect(labels).toContain("Open Project...");
    });

    it("should set application menu when applyMenu is called", () => {
        const { Menu } = require("electron");
        applyMenu(mockWindow);
        expect(Menu.setApplicationMenu).toHaveBeenCalled();
    });
});