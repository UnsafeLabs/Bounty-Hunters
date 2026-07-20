import {
  availabilityFromConnection,
  buildDeveloperMenu,
  buildGitMenu,
  injectDevGitMenus,
  accel,
} from "./DevGitMenus.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const avail = availabilityFromConnection("connected");
const dev = buildDeveloperMenu(avail, "darwin");
assert(dev.label === "Developer", "dev label");
assert(dev.submenu.length === 4, "4 dev items");
const labels = dev.submenu.map((i) => i.label);
assert(
  labels.includes("Toggle Terminal") &&
    labels.includes("Clear Terminal") &&
    labels.includes("Restart Backend") &&
    labels.includes("Open DevTools"),
  "dev items",
);
assert(dev.submenu.every((i) => i.accelerator && i.accelerator.length > 0), "accels");

const git = buildGitMenu(avail, "linux");
assert(git.label === "Git" && git.submenu.length === 5, "5 git items");
assert(
  git.submenu.map((i) => i.label).join("|") ===
    "Stage All Changes|Commit|Push|Pull|Create Branch",
  "git labels",
);
assert(git.submenu.every((i) => i.enabled === true), "enabled when connected");

const disc = buildGitMenu(availabilityFromConnection("disconnected"), "win32");
assert(disc.submenu.every((i) => i.enabled === false), "disabled disconnected");

const injected = injectDevGitMenus(
  [{ label: "File", submenu: [] }, { label: "Help", submenu: [] }],
  avail,
  "darwin",
);
assert(injected.some((m) => m.label === "Developer"), "has Developer");
assert(injected.some((m) => m.label === "Git"), "has Git");
assert(injected.map((m) => m.label).indexOf("Developer") < injected.map((m) => m.label).indexOf("Help"), "before Help");
// existing File untouched
assert(injected[0]!.label === "File", "File preserved");

assert(accel("open-devtools", "darwin").includes("Command"), "mac accel");
assert(accel("open-devtools", "linux").includes("Control"), "linux accel");

console.log("DevGitMenus tests: all passed");
