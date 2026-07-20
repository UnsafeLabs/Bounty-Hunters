import type * as Electron from "electron";
import { parseDeepLink, type DeepLinkAction } from "./parseDeepLink.ts";

const PROTOCOL = "t3code";

export function registerAsDefaultProtocolClient(app: Electron.App): boolean {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      return app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]!,
      ]);
    }
  }
  return app.setAsDefaultProtocolClient(PROTOCOL);
}

export function extractDeepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith("t3code://") || a.startsWith("t3://")) ?? null;
}

export type DeepLinkHandler = (action: DeepLinkAction) => void;

/**
 * Wire open-url (macOS) + second-instance (Windows/Linux) + cold-start argv.
 * Returns dispose function.
 */
export function attachDeepLinkListeners(
  app: Electron.App,
  onAction: DeepLinkHandler,
): () => void {
  const handleRaw = (url: string) => {
    const parsed = parseDeepLink(url);
    if (parsed.ok) onAction(parsed.action);
  };

  const onOpenUrl = (event: Electron.Event, url: string) => {
    event.preventDefault();
    handleRaw(url);
  };

  const onSecondInstance = (_event: Electron.Event, argv: string[]) => {
    const url = extractDeepLinkFromArgv(argv);
    if (url) handleRaw(url);
  };

  app.on("open-url", onOpenUrl);
  app.on("second-instance", onSecondInstance);

  // Cold start: process argv may contain the deep link
  const cold = extractDeepLinkFromArgv(process.argv);
  if (cold) {
    // Defer until app ready typically handled by caller; fire now if already ready
    if (app.isReady()) handleRaw(cold);
    else app.whenReady().then(() => handleRaw(cold));
  }

  return () => {
    app.off("open-url", onOpenUrl);
    app.off("second-instance", onSecondInstance);
  };
}
