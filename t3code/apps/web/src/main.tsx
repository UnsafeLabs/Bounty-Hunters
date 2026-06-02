import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { syncDocumentWindowControlsOverlayClass } from "./lib/windowControlsOverlay";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();

  window.desktopBridge?.onNavigateUrl((urlStr) => {
    try {
      const url = new URL(urlStr);
      if (url.hostname === "settings") {
        void router.navigate({ to: "/settings" });
      } else if (url.hostname === "chat" && url.pathname.startsWith("/thread")) {
        const id = url.searchParams.get("id");
        if (id) {
          void router.navigate({ to: ("/default/" + id) as any });
        }
      } else if (url.hostname === "open" && url.pathname.startsWith("/project")) {
        // Navigate to the root view; opening a project dynamically requires backend support
        void router.navigate({ to: "/" });
      }
    } catch (e) {
      console.error("Failed to route deep link:", e);
    }
  });
}

document.title = APP_DISPLAY_NAME;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
