import {
  detectCiProvider,
  detectContainer,
  detectEnvironment,
  detectWSL,
} from "./EnvironmentDetect.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(detectCiProvider({ GITHUB_ACTIONS: "true" }) === "github_actions", "gha");
assert(detectCiProvider({ GITLAB_CI: "true" }) === "gitlab_ci", "gl");
assert(detectCiProvider({ JENKINS_URL: "http://j" }) === "jenkins", "jk");
assert(detectCiProvider({ CIRCLECI: "true" }) === "circleci", "cc");
assert(detectCiProvider({ TRAVIS: "true" }) === "travis", "tr");
assert(detectCiProvider({ CI: "true" }) === "generic", "ci");
assert(detectCiProvider({}) === null, "none");

assert(detectContainer((p) => p === "/.dockerenv") === true, "dockerenv");
assert(
  detectContainer(() => false, (p) => (p.includes("cgroup") ? "12:memory:/docker/abc" : null)) === true,
  "cgroup",
);
assert(detectContainer(() => false, () => null) === false, "no container");

assert(detectWSL(() => "Linux version ... Microsoft ...") === true, "wsl");
assert(detectWSL(() => "Linux version plain") === false, "not wsl");

const info = detectEnvironment({
  env: {},
  platform: "linux",
  arch: "x64",
  runtime: "node",
  fileExists: () => false,
  readFile: () => null,
});
assert(info.isContainer === false && info.isCI === false && info.ciProvider === null, "defaults");
assert(info.platform === "linux" && info.arch === "x64", "plat");

// no throw on missing
detectEnvironment({ fileExists: () => { throw new Error("x"); }, readFile: () => { throw new Error("y"); } });

console.log("EnvironmentDetect tests: all passed");
