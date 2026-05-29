/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";

export const DEFAULT_PORT = 3773;

export const RuntimeMode = Schema.Literals(["web", "desktop"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const StartupPresentation = Schema.Literals(["browser", "headless"]);
export type StartupPresentation = typeof StartupPresentation.Type;

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;

// Add env validation function
export function validateEnv(): Effect.Effect<never, string, never> {
  const required = ['DATA_DIR', 'TZ'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    return Effect.fail(`Missing required env vars: ${missing.join(', ')}`);
  }
  return Effect.void;
}
