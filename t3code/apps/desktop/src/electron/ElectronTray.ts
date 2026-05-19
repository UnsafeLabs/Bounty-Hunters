import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Electron from "electron";
import * as Path from "node:path";

export type TrayConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface TrayState {
  readonly tooltip: string;
  readonly connectionStatus: TrayConnectionStatus;
  readonly activeProject: string | undefined;
  readonly recentProjects: readonly string[];
}

export interface ElectronTrayShape {
  readonly create: Effect.Effect<void, Error, Scope.Scope>;
  readonly updateStatus: (status: TrayConnectionStatus) => Effect.Effect<void>;
  readonly destroy: Effect.Effect<void>;
}

export class ElectronTray extends Context.Service<ElectronTray, ElectronTrayShape>()(
  "t3/desktop/electron/Tray",
) {}

export const defaultTrayState: TrayState = {
  tooltip: "T3 Code",
  connectionStatus: "disconnected",
  activeProject: undefined,
  recentProjects: [],
};
