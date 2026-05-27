/**
 * Centralized server error types.
 *
 * This module aggregates all domain-specific error modules and defines common
 * error patterns used across the T3 Code server. Import from here instead of
 * defining ad-hoc TaggedError classes in individual files.
 *
 * @module errors
 */

import * as Data from "effect/Data";

// ===============================
// Re-exports from domain-specific error modules
// ===============================

export * from "./provider/Errors.ts";
export * from "./orchestration/Errors.ts";
export * from "./checkpointing/Errors.ts";
export * from "./persistence/Errors.ts";

// ===============================
// Common Error Patterns — Simple Message + Cause
// ===============================

/**
 * ServerRuntimeStartupError - Server startup sequence failure.
 * Origin: serverRuntimeStartup.ts
 */
export class ServerRuntimeStartupError extends Data.TaggedError("ServerRuntimeStartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * AuthError - Authentication service error.
 * Origin: auth/Services/ServerAuth.ts
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly status?: 400 | 401 | 403 | 500;
  readonly cause?: unknown;
}> {}

/**
 * AuthControlPlaneError - Auth control plane operation failure.
 * Origin: auth/Services/AuthControlPlane.ts
 */
export class AuthControlPlaneError extends Data.TaggedError("AuthControlPlaneError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * SecretStoreError - Secret store operation failure.
 * Origin: auth/Services/ServerSecretStore.ts
 */
export class SecretStoreError extends Data.TaggedError("SecretStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * BootstrapCredentialError - Bootstrap credential operation failure.
 * Origin: auth/Services/BootstrapCredentialService.ts
 */
export class BootstrapCredentialError extends Data.TaggedError("BootstrapCredentialError")<{
  readonly message: string;
  readonly status?: 401 | 500;
  readonly cause?: unknown;
}> {}

/**
 * SessionCredentialError - Session credential operation failure.
 * Origin: auth/Services/SessionCredentialService.ts
 */
export class SessionCredentialError extends Data.TaggedError("SessionCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * BootstrapError - Bootstrap envelope read/parse failure.
 * Origin: bootstrap.ts
 */
export class BootstrapError extends Data.TaggedError("BootstrapError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * ProjectCommandError - CLI project command execution failure.
 * Origin: cli/project.ts
 */
export class ProjectCommandError extends Data.TaggedError("ProjectCommandError")<{
  readonly message: string;
}> {}

/**
 * DecodeOtlpTraceRecordsError - OTLP trace records decode failure.
 * Origin: http.ts
 */
export class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: unknown;
}> {}

/**
 * ProjectSetupScriptRunnerError - Setup script runner failure.
 * Origin: project/Services/ProjectSetupScriptRunner.ts
 */
export class ProjectSetupScriptRunnerError extends Data.TaggedError(
  "ProjectSetupScriptRunnerError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * ProviderCommandExecutionError - Snapshot-time provider command failure.
 * Origin: provider/providerSnapshot.ts
 */
export class ProviderCommandExecutionError extends Data.TaggedError(
  "ProviderCommandExecutionError",
)<{
  readonly message: string;
}> {}

/**
 * OpenCodeRuntimeError - OpenCode runtime operation failure.
 * Origin: provider/opencodeRuntime.ts
 */
export class OpenCodeRuntimeError extends Data.TaggedError("OpenCodeRuntimeError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  static readonly is = (u: unknown): u is OpenCodeRuntimeError =>
    typeof u === "object" && u !== null && "operation" in u && "detail" in u;
}

/**
 * ProviderMaintenanceCommandError - Provider maintenance command execution failure.
 * Origin: provider/providerMaintenanceRunner.ts
 */
export class ProviderMaintenanceCommandError extends Data.TaggedError(
  "ProviderMaintenanceCommandError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * ServerCommandError - Server process spawn/communication error.
 * Origin: processRunner.ts
 */
export class ServerCommandError extends Data.TaggedError("ServerCommandError")<{
  readonly command: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
