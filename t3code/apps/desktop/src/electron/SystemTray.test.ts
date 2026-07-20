import {
  buildTooltip,
  createTrayModel,
  statusToTint,
  trayClickAction,
  toggleWindowVisible,
} from "./SystemTray.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(statusToTint("connected") === "green", "green");
assert(statusToTint("reconnecting") === "yellow", "yellow");
assert(statusToTint("disconnected") === "red", "red");
assert(buildTooltip("connected", "Money").includes("Money"), "tooltip");

const model = createTrayModel({
  status: "connected",
  projectName: "demo",
  recentProjects: ["a", "b", "c", "d", "e", "f"],
  windowVisible: true,
});
assert(model.recentProjects.length === 5, "last 5");
assert(model.menu.some((i) => i.id === "toggle" && i.label === "Hide Window"), "hide");
assert(model.menu.some((i) => i.id === "newChat"), "new chat");
assert(model.menu.some((i) => i.id === "quit"), "quit");
assert(model.menu.find((i) => i.id === "recent")?.submenu?.length === 5, "submenu");

assert(trayClickAction("darwin", "left") === "toggle-window", "mac left");
assert(trayClickAction("win32", "right") === "show-menu", "win right");
assert(toggleWindowVisible(true) === false, "toggle");

console.log("SystemTray tests: all passed");
