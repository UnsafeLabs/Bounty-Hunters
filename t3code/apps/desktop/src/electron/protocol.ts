import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { DesktopDeepLink } from "@t3tools/contracts";
import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import { DEEP_LINK_CHANNEL, DEEP_LINK_READY_CHANNEL } from "../ipc/channels.ts";

const windowsPath = Effect.runSync(
  Effect.service(Path.Path).pipe(Effect.provide(NodePath.layerWin32)),
);
const posixPath = Effect.runSync(
  Effect.service(Path.Path).pipe(Effect.provide(NodePath.layerPosix)),
);
const nativePath = process.platform === "win32" ? windowsPath : posixPath;

const directoryExists = (projectPath: string) =>
  Effect.runPromise(
    Effect.service(FileSystem.FileSystem).pipe(
      Effect.flatMap((fs) => fs.stat(projectPath)),
      Effect.map((info) => info.type === "Directory"),
      Effect.catch(() => Effect.succeed(false)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

export function parseDeepLink(raw: string, platform = process.platform): DesktopDeepLink {
  try {
    if (
      raw.length > 8192 ||
      [...raw].some((char) => char <= " " || char === "\u007f") ||
      /%(?![\da-f]{2})/iu.test(raw)
    ) {
      throw new Error("Invalid URL encoding.");
    }
    if (
      !/^t3code:\/\/(?:open\/project|chat\/thread|settings\/?)(?:\?|$)/iu.test(raw) ||
      raw.includes("#")
    ) {
      throw new Error("Unsupported T3 Code link.");
    }
    const url = new URL(raw);
    if (url.protocol !== "t3code:" || url.username || url.password || url.port || url.hash) {
      throw new Error("Invalid T3 Code URL.");
    }
    const route = `${url.hostname}${url.pathname}`;
    const keys = [...url.searchParams.keys()];
    if ((route === "settings" || route === "settings/") && keys.length === 0) {
      return { type: "settings" };
    }
    if (route === "chat/thread" && keys.length === 1 && keys[0] === "id") {
      const id = url.searchParams.get("id")!;
      if (!/^[\w-]{1,256}$/u.test(id)) throw new Error("Invalid thread ID.");
      return { type: "thread", id };
    }
    if (route === "open/project" && keys.length === 1 && keys[0] === "path") {
      const projectPath = url.searchParams.get("path")!;
      // Validate before normalizing: normalization would erase traversal segments.
      if (
        !projectPath ||
        [...projectPath].some((char) => char < " " || char === "\u007f" || char === "\ufffd") ||
        /%[\da-f]{2}/iu.test(projectPath) ||
        projectPath.split(/[\\/]/u).some((segment) => segment === ".." || segment === ".")
      ) {
        throw new Error("Project paths must not contain traversal or encoded path segments.");
      }
      if (platform === "win32") {
        if (
          !/^[a-z]:[\\/]/iu.test(projectPath) ||
          /[<>:"|?*]/u.test(projectPath.slice(2)) ||
          projectPath
            .slice(3)
            .split(/[\\/]/u)
            .some((segment) => /[. ]$/u.test(segment))
        ) {
          throw new Error("A local absolute project path is required.");
        }
        return { type: "project", path: windowsPath.normalize(projectPath) };
      }
      if (
        !projectPath.startsWith("/") ||
        projectPath.startsWith("//") ||
        projectPath.includes("\\")
      ) {
        throw new Error("A local absolute project path is required.");
      }
      return { type: "project", path: posixPath.normalize(projectPath) };
    }
    throw new Error("Unsupported T3 Code link or parameters.");
  } catch (error) {
    return {
      type: "error",
      message: error instanceof Error ? error.message : "Invalid T3 Code link.",
    };
  }
}

export function createProtocolHandler(isDirectory = directoryExists) {
  const pending: DesktopDeepLink[] = [];
  let window: BrowserWindow | undefined;
  let ready = false;
  let activate: (() => void) | undefined;
  let validation = Promise.resolve();

  const focus = () => {
    if (!window || window.isDestroyed()) {
      activate?.();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const flush = () => {
    if (!ready || !window || window.isDestroyed()) return;
    for (const link of pending.splice(0)) window.webContents.send(DEEP_LINK_CHANNEL, link);
  };
  const receive = (raw: string) => {
    focus();
    validation = validation.then(async () => {
      let link = parseDeepLink(raw);
      if (link.type === "project") {
        try {
          if (!(await isDirectory(link.path))) throw new Error("Not a directory.");
        } catch {
          link = {
            type: "error",
            message: "The project directory does not exist or cannot be accessed.",
          };
        }
      }
      pending.push(link);
      flush();
    });
  };
  const receiveArguments = (argv: readonly string[]) => {
    for (const value of argv) if (/^t3code:/iu.test(value)) receive(value);
  };
  const onOpenUrl = (event: { preventDefault: () => void }, url: string) => {
    event.preventDefault();
    receive(url);
  };
  const onSecondInstance = (_event: unknown, argv: string[]) => {
    focus();
    receiveArguments(argv);
  };
  const onReady = (event: IpcMainEvent, value: unknown) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return;
    ready = value === true;
    flush();
  };
  // macOS can deliver the launch URL before app.whenReady().
  app.on("open-url", onOpenUrl);
  app.on("second-instance", onSecondInstance);
  ipcMain.on(DEEP_LINK_READY_CHANNEL, onReady);
  receiveArguments(process.argv);

  return {
    start(onActivate: () => void) {
      activate = onActivate;
      if (!app.requestSingleInstanceLock()) return false;
      const registered =
        process.defaultApp && process.argv[1]
          ? app.setAsDefaultProtocolClient("t3code", process.execPath, [
              nativePath.resolve(process.argv[1]),
            ])
          : app.setAsDefaultProtocolClient("t3code");
      if (!registered)
        Effect.runSync(Effect.logWarning("Could not register the t3code protocol handler."));
      return true;
    },
    attachWindow(nextWindow: BrowserWindow) {
      window = nextWindow;
      ready = false;
      nextWindow.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (window === nextWindow && isMainFrame && !isInPlace) ready = false;
      });
      nextWindow.on("closed", () => {
        if (window === nextWindow) {
          window = undefined;
          ready = false;
        }
      });
    },
    dispose() {
      app.removeListener("open-url", onOpenUrl);
      app.removeListener("second-instance", onSecondInstance);
      ipcMain.removeListener(DEEP_LINK_READY_CHANNEL, onReady);
    },
  };
}

export let deepLinkProtocol: ReturnType<typeof createProtocolHandler> | undefined;

export function registerProtocol() {
  deepLinkProtocol ??= createProtocolHandler();
}
