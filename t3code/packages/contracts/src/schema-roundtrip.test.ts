import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  TrimmedString,
  TrimmedNonEmptyString,
  NonNegativeInt,
  PositiveInt,
  PortSchema,
} from "./baseSchemas.ts";
import {
  ServerAuthDescriptor,
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientSession,
  AuthAccessSnapshot,
  AuthClientMetadata,
} from "./auth.ts";
import {
  DesktopBackendBootstrap,
} from "./desktopBootstrap.ts";
import {
  EditorLaunchStyle,
  LaunchEditorInput,
} from "./editor.ts";
import {
  ExecutionEnvironmentDescriptor,
  RepositoryIdentity,
  ScopedProjectRef,
} from "./environment.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseEntry,
  FilesystemBrowseResult,
} from "./filesystem.ts";
import {
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsPullInput,
  VcsRef,
} from "./git.ts";
import {
  ContextMenuItemSchema,
  DesktopUpdateStateSchema,
  DesktopAppBrandingSchema,
  DesktopSshEnvironmentTargetSchema,
} from "./ipc.ts";
import {
  KeybindingRule,
  KeybindingShortcut,
  ResolvedKeybindingRule,
} from "./keybindings.ts";
import {
  ProviderOptionChoice,
  ProviderOptionSelection,
  ModelCapabilities,
} from "./model.ts";
import {
  ProjectSearchEntriesInput,
  ProjectEntry,
  ProjectWriteFileInput,
} from "./project.ts";
import {
  ProviderSessionStartInput,
  ProviderSendTurnInput,
  ProviderTurnStartResult,
  ProviderEvent,
} from "./provider.ts";
import {
  ProviderInstanceRef,
  ProviderInstanceConfig,
} from "./providerInstance.ts";
import {
  RuntimeEventRaw,
  ThreadTokenUsageSnapshot,
  ItemLifecyclePayload,
} from "./providerRuntime.ts";

// ===== Helper: round-trip test =====
function roundtripTest<T>(
  name: string,
  schema: Schema.Schema<T>,
  validInput: unknown,
) {
  it.effect(`round-trip: ${name}`, () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(schema)(validInput);
      const encoded = yield* Schema.encodeEffect(schema)(decoded);
      assert.deepStrictEqual(encoded, validInput);
    }),
  );
}

function invalidValueTest<T>(
  name: string,
  schema: Schema.Schema<T>,
  invalidInput: unknown,
) {
  it.effect(`rejects invalid: ${name}`, () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Schema.decodeUnknownEffect(schema)(invalidInput),
      );
      assert.ok(result._tag === "Left", `Expected Left for invalid input: ${name}`);
    }),
  );
}

// ===== Base Schemas =====
roundtripTest("TrimmedString", TrimmedString, "hello");
roundtripTest("TrimmedNonEmptyString", TrimmedNonEmptyString, "world");
roundtripTest("NonNegativeInt", NonNegativeInt, 0);
roundtripTest("NonNegativeInt >0", NonNegativeInt, 42);
roundtripTest("PositiveInt", PositiveInt, 1);
roundtripTest("PositiveInt large", PositiveInt, 999999);
roundtripTest("PortSchema", PortSchema, 8080);
roundtripTest("PortSchema min", PortSchema, 1);
roundtripTest("PortSchema max", PortSchema, 65535);
invalidValueTest("TrimmedString empty rejects", TrimmedNonEmptyString, "");
invalidValueTest("NonNegativeInt negative rejects", NonNegativeInt, -1);
invalidValueTest("PositiveInt zero rejects", PositiveInt, 0);
invalidValueTest("PortSchema too low", PortSchema, 0);
invalidValueTest("PortSchema too high", PortSchema, 65536);

// ===== Auth =====
roundtripTest("ServerAuthDescriptor", ServerAuthDescriptor, {
  policy: "optional",
  bootstrapMethod: "desktop-bootstrap",
  sessionMethod: "pairing-link",
  sessionRole: "owner",
});
roundtripTest("AuthBootstrapInput", AuthBootstrapInput, {
  method: "desktop-bootstrap",
});
roundtripTest("AuthBootstrapResult", AuthBootstrapResult, {
  kind: "bearer",
  token: "test-token-12345",
  webSocketUrl: "ws://localhost:5733/ws",
});
roundtripTest("AuthClientMetadata", AuthClientMetadata, {
  deviceType: "desktop",
  hostname: "my-pc",
  clientVersion: "1.0.0",
  agentName: "test-agent",
});

// ===== Desktop Bootstrap =====
roundtripTest("DesktopBackendBootstrap", DesktopBackendBootstrap, {
  backendInfo: {
    version: "1.0.0",
    platform: "win32",
    arch: "x64",
  },
  capabilities: {
    remote: false,
    desktopBootstrap: true,
  },
});

// ===== Editor =====
roundtripTest("EditorLaunchStyle", EditorLaunchStyle, "direct-path");
roundtripTest("LaunchEditorInput", LaunchEditorInput, {
  editorId: "vscode",
  style: "direct-path",
  filePath: "/home/user/project/src/main.ts",
  line: 42,
  column: 10,
});

// ===== Environment =====
roundtripTest("ExecutionEnvironmentDescriptor", ExecutionEnvironmentDescriptor, {
  platform: { os: "win32", arch: "x64" },
  capabilities: { remote: false, desktopBootstrap: true },
});
roundtripTest("RepositoryIdentity", RepositoryIdentity, {
  remoteUrl: "https://github.com/user/repo.git",
  workdirPath: "/home/user/repo",
});
roundtripTest("ScopedProjectRef", ScopedProjectRef, {
  identity: {
    remoteUrl: "https://github.com/user/repo.git",
    workdirPath: "/home/user/repo",
  },
  branch: "main",
});

// ===== Filesystem =====
roundtripTest("FilesystemBrowseInput", FilesystemBrowseInput, {
  path: "/home/user",
  showHidden: false,
});
roundtripTest("FilesystemBrowseEntry", FilesystemBrowseEntry, {
  name: "file.txt",
  path: "/home/user/file.txt",
  kind: "file",
  size: 1024,
});
roundtripTest("FilesystemBrowseResult", FilesystemBrowseResult, {
  entries: [
    { name: "file.txt", path: "/home/user/file.txt", kind: "file", size: 1024 },
    { name: "subdir", path: "/home/user/subdir", kind: "directory" },
  ],
});
invalidValueTest("FilesystemBrowseInput missing path", FilesystemBrowseInput, {
  showHidden: true,
});

// ===== Git =====
roundtripTest("VcsRef", VcsRef, {
  ref: "refs/heads/main",
  sha: "abc123def456",
  message: "Initial commit",
});
roundtripTest("VcsStatusInput", VcsStatusInput, {
  workdirPath: "/home/user/repo",
});
roundtripTest("VcsPullInput", VcsPullInput, {
  workdirPath: "/home/user/repo",
  remote: "origin",
  branch: "main",
});
roundtripTest("GitRunStackedActionInput", GitRunStackedActionInput, {
  action: "branch",
  workdirPath: "/home/user/repo",
  branch: "feature/my-feature",
  baseRef: "main",
});

// ===== IPC =====
roundtripTest("ContextMenuItemSchema", ContextMenuItemSchema, {
  id: "menu-item-1",
  label: "Menu Item",
  disabled: false,
});
roundtripTest("DesktopUpdateStateSchema", DesktopUpdateStateSchema, {
  status: "idle",
  updateChannel: "latest",
  currentVersion: "1.0.0",
});
roundtripTest("DesktopAppBrandingSchema", DesktopAppBrandingSchema, {
  displayName: "T3 Code",
  version: "1.0.0",
  stageLabel: "Dev",
  theme: "dark",
});

// ===== Keybindings =====
roundtripTest("KeybindingRule", KeybindingRule, {
  command: "chat:send",
  key: "Enter",
  when: "chat:focus",
});
roundtripTest("KeybindingShortcut", KeybindingShortcut, {
  keys: ["Ctrl", "K"],
  label: "Open Command Palette",
  when: "app:focused",
});

// ===== Model =====
roundtripTest("ProviderOptionChoice", ProviderOptionChoice, {
  value: "gpt-4",
  label: "GPT-4",
});
roundtripTest("ProviderOptionSelection", ProviderOptionSelection, {
  id: "model",
  value: "gpt-4",
});
roundtripTest("ModelCapabilities", ModelCapabilities, {
  maxTokens: 8192,
  supportsStreaming: true,
  supportsFunctions: true,
  supportsVision: false,
});

// ===== Project =====
roundtripTest("ProjectSearchEntriesInput", ProjectSearchEntriesInput, {
  query: "test",
  rootPath: "/home/user/project",
});
roundtripTest("ProjectEntry", ProjectEntry, {
  path: "/home/user/project/src/main.ts",
  relativePath: "src/main.ts",
  kind: "file",
});
roundtripTest("ProjectWriteFileInput", ProjectWriteFileInput, {
  path: "/home/user/project/src/main.ts",
  content: "console.log('hello');",
});

// ===== Provider =====
roundtripTest("ProviderSessionStartInput", ProviderSessionStartInput, {
  instanceId: "openai-instance",
  sessionId: "sess-123",
  model: "gpt-4",
});
roundtripTest("ProviderSendTurnInput", ProviderSendTurnInput, {
  sessionId: "sess-123",
  message: "Hello!",
});
roundtripTest("ProviderTurnStartResult", ProviderTurnStartResult, {
  turnId: "turn-456",
  sessionId: "sess-123",
});

// ===== Provider Instance =====
roundtripTest("ProviderInstanceRef", ProviderInstanceRef, {
  instanceId: "openai-instance",
  driverKind: "openai",
  displayName: "My OpenAI",
});
roundtripTest("ProviderInstanceConfig", ProviderInstanceConfig, {
  driverKind: "openai",
  displayName: "My OpenAI",
  enabled: true,
  environment: [
    { name: "OPENAI_API_KEY", value: "sk-..." },
  ],
});

// ===== Provider Runtime =====
roundtripTest("ThreadTokenUsageSnapshot", ThreadTokenUsageSnapshot, {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
});
roundtripTest("RuntimeEventRaw", RuntimeEventRaw, {
  data: JSON.stringify({ key: "value" }),
  chunkIndex: 0,
});

// ===== Unicode and edge cases =====
roundtripTest("TrimmedString with unicode", TrimmedString, "héllo wörld 🎉");
roundtripTest("TrimmedString special chars", TrimmedString, "a!@#$%^&*()_+-=[]{}|;':\",./<>?~");

// Large strings
const longString = "x".repeat(1000);
roundtripTest("TrimmedString long (1000 chars)", TrimmedString, longString);

// Empty/near-empty (for TrimmedString which allows empty)
roundtripTest("TrimmedString empty", TrimmedString, "");

// Binary-like content
roundtripTest("TrimmedString with tabs and newlines", TrimmedString, "line1\nline2\nline3");
