export * from "./advertisedEndpoint.ts";
export * from "./knownEnvironment.ts";
export * from "./scoped.ts";
export * from "./sourceControlDiscoveryState.ts";

// Environment detection (Docker, CI, WSL)
export {
  detectEnvironment,
  detectEnvironmentSync,
  detectCIProvider,
  detectDocker,
  detectDockerSync,
  detectWSL,
  detectWSLSync,
  
} from "./environmentDetection";
export type {
  EnvironmentInfo,
  CIProvider,
} from "./environmentDetection";
