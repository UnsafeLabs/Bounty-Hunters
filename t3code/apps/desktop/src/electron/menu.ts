import {
    Menu,
    MenuItem,
    BrowserWindow,
    app,
    dialog,
    shell,
} from "electron";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function createGitMenu(mainWindow: BrowserWindow): MenuItem {
    return new MenuItem({
        label: "Git",
        submenu: [
            {
                label: "Stage All Changes",
                accelerator: "CmdOrCtrl+Shift+A",
                click: async () => {
                    try {
                        const { stdout } = await execAsync("git add -A", {
                            cwd: app.getAppPath(),
                        });
                        mainWindow.webContents.send("git-result", {
                            action: "stage",
                            output: stdout || "All changes staged",
                        });
                    } catch (error: any) {
                        mainWindow.webContents.send("git-result", {
                            action: "stage",
                            output: error.message || "Failed to stage changes",
                            error: true,
                        });
                    }
                },
            },
            {
                label: "Commit",
                accelerator: "CmdOrCtrl+Shift+C",
                click: () => {
                    mainWindow.webContents.send("git-commit-dialog");
                },
            },
            {
                label: "Commit with Message...",
                click: async () => {
                    const { response } = await dialog.showMessageBox(mainWindow, {
                        type: "question",
                        title: "Commit Message",
                        message: "Enter commit message:",
                        buttons: ["Commit", "Cancel"],
                        defaultId: 0,
                    });
                },
            },
            { type: "separator" },
            {
                label: "Push",
                accelerator: "CmdOrCtrl+Shift+P",
                click: async () => {
                    try {
                        const { stdout } = await execAsync("git push", {
                            cwd: app.getAppPath(),
                        });
                        mainWindow.webContents.send("git-result", {
                            action: "push",
                            output: stdout || "Push successful",
                        });
                    } catch (error: any) {
                        mainWindow.webContents.send("git-result", {
                            action: "push",
                            output: error.message || "Push failed",
                            error: true,
                        });
                    }
                },
            },
            {
                label: "Pull",
                accelerator: "CmdOrCtrl+Shift+L",
                click: async () => {
                    try {
                        const { stdout } = await execAsync("git pull", {
                            cwd: app.getAppPath(),
                        });
                        mainWindow.webContents.send("git-result", {
                            action: "pull",
                            output: stdout || "Pull successful",
                        });
                    } catch (error: any) {
                        mainWindow.webContents.send("git-result", {
                            action: "pull",
                            output: error.message || "Pull failed",
                            error: true,
                        });
                    }
                },
            },
            { type: "separator" },
            {
                label: "Create Branch...",
                click: async () => {
                    const { response } = await dialog.showMessageBox(mainWindow, {
                        type: "question",
                        title: "New Branch",
                        message: "Create a new Git branch:",
                        buttons: ["Create", "Cancel"],
                    });
                },
            },
            {
                label: "Switch Branch...",
                click: () => {
                    mainWindow.webContents.send("git-branch-dialog");
                },
            },
        ],
    });
}

function createDeveloperMenu(mainWindow: BrowserWindow): MenuItem {
    return new MenuItem({
        label: "Developer",
        submenu: [
            {
                label: "Toggle Terminal",
                accelerator: "CmdOrCtrl+`",
                click: () => {
                    mainWindow.webContents.send("toggle-terminal");
                },
            },
            {
                label: "Clear Terminal",
                click: () => {
                    mainWindow.webContents.send("clear-terminal");
                },
            },
            { type: "separator" },
            {
                label: "Restart Backend",
                accelerator: "CmdOrCtrl+Shift+R",
                click: () => {
                    mainWindow.webContents.send("restart-backend");
                },
            },
            { type: "separator" },
            {
                label: "Open DevTools",
                accelerator: "CmdOrCtrl+Shift+I",
                click: () => {
                    mainWindow.webContents.openDevTools({ mode: "detach" });
                },
            },
            {
                label: "Open DevTools (Docked)",
                click: () => {
                    mainWindow.webContents.openDevTools({ mode: "bottom" });
                },
            },
            { type: "separator" },
            {
                label: "Reload Window",
                accelerator: "CmdOrCtrl+R",
                click: () => {
                    mainWindow.webContents.reload();
                },
            },
            {
                label: "Force Reload",
                accelerator: "CmdOrCtrl+Shift+F5",
                click: () => {
                    mainWindow.webContents.reloadIgnoringCache();
                },
            },
        ],
    });
}

export function buildApplicationMenu(mainWindow: BrowserWindow): Menu {
    const isMac = process.platform === "darwin";

    const template: (MenuItem | Electron.MenuItemConstructorOptions)[] = [
        ...(isMac
            ? [
                  {
                      label: app.name,
                      submenu: [
                          { role: "about" as const },
                          { type: "separator" as const },
                          { role: "services" as const },
                          { type: "separator" as const },
                          { role: "hide" as const },
                          { role: "hideOthers" as const },
                          { role: "unhide" as const },
                          { type: "separator" as const },
                          { role: "quit" as const },
                      ],
                  },
              ]
            : []),
        {
            label: "File",
            submenu: [
                {
                    label: "New Project",
                    accelerator: "CmdOrCtrl+N",
                    click: () => mainWindow.webContents.send("new-project"),
                },
                {
                    label: "Open Project...",
                    accelerator: "CmdOrCtrl+O",
                    click: () => mainWindow.webContents.send("open-project"),
                },
                { type: "separator" },
                {
                    label: "Save",
                    accelerator: "CmdOrCtrl+S",
                    click: () => mainWindow.webContents.send("save"),
                },
                { type: "separator" },
                isMac ? { role: "close" } : { role: "quit" },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
            ],
        },
        {
            label: "View",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
    ];

    template.push(createDeveloperMenu(mainWindow));
    template.push(createGitMenu(mainWindow));

    if (!isMac) {
        template.push({
            label: "Help",
            submenu: [
                {
                    label: "About",
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: "info",
                            title: "About T3 Code",
                            message: "T3 Code - AI-Powered Development Environment",
                        });
                    },
                },
            ],
        });
    }

    const menu = Menu.buildFromTemplate(
        template as Electron.MenuItemConstructorOptions[]
    );
    return menu;
}

export function applyMenu(mainWindow: BrowserWindow): void {
    const menu = buildApplicationMenu(mainWindow);
    Menu.setApplicationMenu(menu);
}