import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect } from "vitest";

// ============ auth.ts types ============
import {
  ServerAuthPolicy,
  ServerAuthBootstrapMethod,
  AuthSessionRole,
  ServerAuthDescriptor,
  AuthBootstrapInput,
  AuthClientMetadata,
  AuthSessionState,
} from "./auth.ts";

// ============ baseSchemas.ts types ============
import {
  TrimmedString,
  TrimmedNonEmptyString,
  NonNegativeInt,
  PositiveInt,
  PortSchema,
  IsoDateTime,
  ThreadId,
  ProjectId,
  CommandId,
  TurnId,
} from "./baseSchemas.ts";

// ============ editor.ts types ============
import {
  EditorLaunchStyle,
  LaunchEditorInput,
} from "./editor.ts";

// ============ environment.ts types ============
import {
  ExecutionEnvironmentPlatformOs,
  ExecutionEnvironmentPlatformArch,
  ExecutionEnvironmentPlatform,
  ExecutionEnvironmentDescriptor,
} from "./environment.ts";

// ============ filesystem.ts types ============
import {
  FilesystemBrowseInput,
  FilesystemBrowseEntry,
  FilesystemBrowseResult,
} from "./filesystem.ts";

// ============ git.ts types ============
import {
  GitStackedAction,
  GitActionProgressPhase,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
} from "./git.ts";

// ============ ipc.ts types ============
import {
  ContextMenuItemSchema,
  DesktopUpdateStatusSchema,
  DesktopThemeSchema,
} from "./ipc.ts";

// ============ keybindings.ts types ============
import {
  KeybindingRule,
  KeybindingsConfig,
  ResolvedKeybindingRule,
} from "./keybindings.ts";

// ============ model.ts types ============
import {
  ProviderOptionDescriptorType,
  ProviderOptionChoice,
} from "./model.ts";

// ============ orchestration.ts types ============
import {
  ProviderApprovalPolicy,
  ProviderSandboxMode,
  ModelSelection,
  RuntimeMode,
  ProviderRequestKind,
  ProjectCreateCommand,
  ThreadTurnStartCommand,
  ProjectCreatedPayload,
  OrchestrationGetTurnDiffInput,
} from "./orchestration.ts";

// ============ project.ts types ============
import {
  ProjectSearchEntriesInput,
  ProjectEntry,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
} from "./project.ts";

// ============ provider.ts types ============
import {
  ProviderSessionStartInput,
  ProviderSendTurnInput,
  ProviderTurnStartResult,
} from "./provider.ts";

// ============ providerInstance.ts types ============
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderInstanceRef,
  ProviderInstanceConfig,
} from "./providerInstance.ts";

// ============ providerRuntime.ts types ============
import {
  ProviderRuntimeEvent,
  ProviderRuntimeTurnStatus,
} from "./providerRuntime.ts";

// ============ remoteAccess.ts types ============
import {
  AdvertisedEndpointProviderKind,
  AdvertisedEndpointReachability,
  AdvertisedEndpoint,
} from "./remoteAccess.ts";

// ============ server.ts types ============
import {
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
} from "./server.ts";

// ============ settings.ts types ============
import {
  ClientSettingsSchema,
  TimestampFormat,
} from "./settings.ts";

// ============ sourceControl.ts types ============
import {
  SourceControlProviderKind,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";

// ============ terminal.ts types ============
import {
  TerminalOpenInput,
  TerminalWriteInput,
  TerminalResizeInput,
  TerminalEvent,
  TerminalSessionSnapshot,
} from "./terminal.ts";

// ============ vcs.ts types ============
import {
  VcsDriverKind,
  VcsFreshness,
} from "./vcs.ts";

// ============ rpc.ts types ============
import {
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
} from "./rpc.ts";

// ============ desktopBootstrap.ts types ============
import {
  DesktopBackendBootstrap,
} from "./desktopBootstrap.ts";

// ============ Helper ============
function roundTrip<S extends Schema.Top>(
  schema: S,
  input: Schema.Schema.Encoded<S>,
): void {
  const decoded = Schema.decodeUnknownSync(schema as never)(input);
  const reEncoded = Schema.encodeSync(schema as never)(decoded);
  expect(reEncoded).toEqual(input);
}

function decodeOnly<S extends Schema.Top>(
  schema: S,
  input: unknown,
): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input);
}

// =====================================
// baseSchemas.ts — branded types & primitives
// =====================================
describe("baseSchemas round-trip", () => {
  it("TrimmedString round-trips and trims whitespace", () => {
    roundTrip(TrimmedString as never, "hello world");
    roundTrip(TrimmedString as never, "");
    expect(Schema.decodeUnknownSync(TrimmedString as never)("  hello  ")).toBe("hello");
  });

  it("TrimmedNonEmptyString rejects empty string", () => {
    roundTrip(TrimmedNonEmptyString as never, "valid");
    expect(() => Schema.decodeUnknownSync(TrimmedNonEmptyString as never)("")).toThrow();
  });

  it("NonNegativeInt accepts 0 and positive, rejects negative", () => {
    roundTrip(NonNegativeInt as never, 0);
    roundTrip(NonNegativeInt as never, 42);
    expect(() => Schema.decodeUnknownSync(NonNegativeInt as never)(-1)).toThrow();
  });

  it("PositiveInt rejects 0 and negative", () => {
    roundTrip(PositiveInt as never, 1);
    roundTrip(PositiveInt as never, 999);
    expect(() => Schema.decodeUnknownSync(PositiveInt as never)(0)).toThrow();
  });

  it("PortSchema validates port range 1-65535", () => {
    roundTrip(PortSchema as never, 80);
    roundTrip(PortSchema as never, 443);
    roundTrip(PortSchema as never, 65535);
    expect(() => Schema.decodeUnknownSync(PortSchema as never)(0)).toThrow();
    expect(() => Schema.decodeUnknownSync(PortSchema as never)(70000)).toThrow();
  });

  it("IsoDateTime round-trips valid ISO dates", () => {
    roundTrip(IsoDateTime as never, "2026-04-10T00:00:00.000Z");
    roundTrip(IsoDateTime as never, "2025-12-31T23:59:59.999Z");
  });

  it("ThreadId decodes branded string", () => {
    expect(decodeOnly(ThreadId as never, "thread-abc-123")).toBe("thread-abc-123");
  });

  it("ProjectId decodes branded string", () => {
    expect(decodeOnly(ProjectId as never, "proj-xyz")).toBe("proj-xyz");
  });

  it("CommandId decodes branded string", () => {
    expect(decodeOnly(CommandId as never, "cmd-123")).toBe("cmd-123");
  });

  it("TurnId decodes branded string", () => {
    expect(decodeOnly(TurnId as never, "turn-999")).toBe("turn-999");
  });
});

// =====================================
// auth.ts
// =====================================
describe("auth schemas round-trip", () => {
  it("ServerAuthPolicy literals", () => {
    roundTrip(ServerAuthPolicy as never, "open");
    roundTrip(ServerAuthPolicy as never, "token");
    expect(() => Schema.decodeUnknownSync(ServerAuthPolicy as never)("unknown")).toThrow();
  });

  it("ServerAuthBootstrapMethod literals", () => {
    roundTrip(ServerAuthBootstrapMethod as never, "desktop-bootstrap");
    roundTrip(ServerAuthBootstrapMethod as never, "one-time-token");
  });

  it("AuthSessionRole literals", () => {
    roundTrip(AuthSessionRole as never, "owner");
    roundTrip(AuthSessionRole as never, "client");
  });

  it("AuthClientMetadata struct", () => {
    roundTrip(AuthClientMetadata as never, {
      name: "My Browser",
      deviceType: "browser",
      os: "Windows 10",
    });
  });

  it("AuthSessionState literals", () => {
    roundTrip(AuthSessionState as never, "active");
    roundTrip(AuthSessionState as never, "expired");
    roundTrip(AuthSessionState as never, "revoked");
  });

  it("AuthBootstrapInput with optional token", () => {
    roundTrip(AuthBootstrapInput as never, { method: "desktop-bootstrap" });
    roundTrip(AuthBootstrapInput as never, { method: "one-time-token", token: "abc-123-secret" });
  });

  it("ServerAuthDescriptor with optional bootstrap", () => {
    roundTrip(ServerAuthDescriptor as never, { policy: "open" });
    roundTrip(ServerAuthDescriptor as never, {
      policy: "token",
      bootstrap: { method: "desktop-bootstrap" },
    });
  });
});

// =====================================
// editor.ts
// =====================================
describe("editor schemas round-trip", () => {
  it("EditorLaunchStyle literals", () => {
    roundTrip(EditorLaunchStyle as never, "direct-path");
    roundTrip(EditorLaunchStyle as never, "goto");
    roundTrip(EditorLaunchStyle as never, "line-column");
  });

  it("LaunchEditorInput with optional line/column", () => {
    roundTrip(LaunchEditorInput as never, {
      editorId: "code",
      filePath: "/project/src/index.ts",
      line: 42,
      column: 10,
    });
    roundTrip(LaunchEditorInput as never, {
      editorId: "code",
      filePath: "/project/README.md",
    });
  });
});

// =====================================
// environment.ts
// =====================================
describe("environment schemas round-trip", () => {
  it("ExecutionEnvironmentPlatformOs literals", () => {
    roundTrip(ExecutionEnvironmentPlatformOs as never, "darwin");
    roundTrip(ExecutionEnvironmentPlatformOs as never, "linux");
    roundTrip(ExecutionEnvironmentPlatformOs as never, "win32");
  });

  it("ExecutionEnvironmentPlatformArch literals", () => {
    roundTrip(ExecutionEnvironmentPlatformArch as never, "arm64");
    roundTrip(ExecutionEnvironmentPlatformArch as never, "x64");
  });

  it("ExecutionEnvironmentPlatform struct", () => {
    roundTrip(ExecutionEnvironmentPlatform as never, { os: "darwin", arch: "arm64" });
    roundTrip(ExecutionEnvironmentPlatform as never, { os: "linux", arch: "x64" });
  });

  it("ExecutionEnvironmentDescriptor with capabilities", () => {
    roundTrip(ExecutionEnvironmentDescriptor as never, {
      hostname: "dev-machine",
      username: "dev",
      platform: { os: "darwin", arch: "arm64" },
      capabilities: { git: true, docker: false, bun: true, node: true, bash: true },
    });
  });
});

// =====================================
// filesystem.ts
// =====================================
describe("filesystem schemas round-trip", () => {
  it("FilesystemBrowseInput", () => {
    roundTrip(FilesystemBrowseInput as never, { cwd: "/project", pattern: "*.ts" });
  });

  it("FilesystemBrowseEntry with byteSize", () => {
    roundTrip(FilesystemBrowseEntry as never, {
      path: "src/index.ts",
      type: "file",
      byteSize: 1024,
    });
  });

  it("FilesystemBrowseResult with mixed entries", () => {
    roundTrip(FilesystemBrowseResult as never, {
      entries: [
        { path: "src/index.ts", type: "file", byteSize: 1024 },
        { path: "src/components", type: "dir", byteSize: 0 },
      ],
    });
  });
});

// =====================================
// git.ts
// =====================================
describe("git schemas round-trip", () => {
  it("GitStackedAction literals", () => {
    roundTrip(GitStackedAction as never, "commit");
    roundTrip(GitStackedAction as never, "push");
    roundTrip(GitStackedAction as never, "pr");
  });

  it("GitActionProgressPhase literals", () => {
    roundTrip(GitActionProgressPhase as never, "branch");
    roundTrip(GitActionProgressPhase as never, "commit");
    roundTrip(GitActionProgressPhase as never, "push");
    roundTrip(GitActionProgressPhase as never, "pr");
  });

  it("VcsCreateWorktreeInput with optional newRefName", () => {
    roundTrip(VcsCreateWorktreeInput as never, {
      cwd: "/repo",
      refName: "feature/new-feature",
      path: "/tmp/worktree-feature",
    });
    roundTrip(VcsCreateWorktreeInput as never, {
      cwd: "/repo",
      refName: "main",
      path: "/tmp/worktree-main",
      newRefName: "feature/from-main",
    });
  });

  it("VcsCreateWorktreeResult", () => {
    roundTrip(VcsCreateWorktreeResult as never, {
      worktreePath: "/tmp/worktree-feature",
    });
  });

  it("GitResolvePullRequestResult with state", () => {
    roundTrip(GitResolvePullRequestResult as never, {
      pullRequest: {
        number: 42,
        title: "Fix bug",
        url: "https://github.com/owner/repo/pull/42",
        baseBranch: "main",
        headBranch: "fix/bug",
        state: "open",
      },
    });
  });

  it("GitRunStackedActionInput with message", () => {
    roundTrip(GitRunStackedActionInput as never, {
      cwd: "/repo",
      action: "commit",
      message: "fix: resolve edge case",
    });
  });
});

// =====================================
// keybindings.ts
// =====================================
describe("keybindings schemas round-trip", () => {
  it("KeybindingRule with optional when", () => {
    roundTrip(KeybindingRule as never, { key: "mod+s", command: "chat.submitTurn" });
    roundTrip(KeybindingRule as never, {
      key: "mod+shift+k",
      command: "commandPalette.toggle",
      when: "editorFocus",
    });
  });

  it("KeybindingsConfig array wrapper", () => {
    roundTrip(KeybindingsConfig as never, {
      rules: [{ key: "mod+s", command: "chat.submitTurn" }],
    });
  });

  it("ResolvedKeybindingRule", () => {
    roundTrip(ResolvedKeybindingRule as never, {
      key: "mod+s",
      command: "chat.submitTurn",
    });
  });
});

// =====================================
// model.ts
// =====================================
describe("model schemas round-trip", () => {
  it("ProviderOptionDescriptorType literals", () => {
    roundTrip(ProviderOptionDescriptorType as never, "select");
    roundTrip(ProviderOptionDescriptorType as never, "boolean");
  });

  it("ProviderOptionChoice struct", () => {
    roundTrip(ProviderOptionChoice as never, { label: "GPT-5", value: "gpt-5" });
  });
});

// =====================================
// orchestration.ts
// =====================================
describe("orchestration schemas round-trip", () => {
  it("ProviderApprovalPolicy literals", () => {
    roundTrip(ProviderApprovalPolicy as never, "auto");
    roundTrip(ProviderApprovalPolicy as never, "manual");
    roundTrip(ProviderApprovalPolicy as never, "decline");
  });

  it("ProviderSandboxMode literals", () => {
    roundTrip(ProviderSandboxMode as never, "none");
    roundTrip(ProviderSandboxMode as never, "persistent");
    roundTrip(ProviderSandboxMode as never, "ephemeral");
  });

  it("RuntimeMode literals", () => {
    roundTrip(RuntimeMode as never, "full-access");
    roundTrip(RuntimeMode as never, "sandbox");
  });

  it("ProviderRequestKind literals", () => {
    roundTrip(ProviderRequestKind as never, "command");
    roundTrip(ProviderRequestKind as never, "file-read");
    roundTrip(ProviderRequestKind as never, "file-change");
  });

  it("ModelSelection with optional options array", () => {
    roundTrip(ModelSelection as never, { provider: "codex", model: "gpt-4o" });
    roundTrip(ModelSelection as never, {
      provider: "anthropic",
      model: "claude-sonnet-4",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });

  it("ProjectCreateCommand", () => {
    roundTrip(ProjectCreateCommand as never, {
      title: "My Project",
      cwd: "/home/user/projects/my-project",
    });
  });

  it("ProjectCreatedPayload with isActive", () => {
    roundTrip(ProjectCreatedPayload as never, {
      projectId: "proj-123",
      isActive: true,
    });
  });

  it("OrchestrationGetTurnDiffInput", () => {
    roundTrip(OrchestrationGetTurnDiffInput as never, {
      threadId: "thread-456",
      turnId: "turn-001",
    });
  });
});

// =====================================
// project.ts
// =====================================
describe("project schemas round-trip", () => {
  it("ProjectSearchEntriesInput", () => {
    roundTrip(ProjectSearchEntriesInput as never, {
      projectId: "proj-123",
      query: "index.ts",
    });
  });

  it("ProjectEntry with type", () => {
    roundTrip(ProjectEntry as never, { path: "src/index.ts", type: "file" });
  });

  it("ProjectSearchEntriesResult with entries array", () => {
    roundTrip(ProjectSearchEntriesResult as never, {
      entries: [
        { path: "src/index.ts", type: "file" },
        { path: "src/utils", type: "dir" },
      ],
    });
  });

  it("ProjectWriteFileInput with content", () => {
    roundTrip(ProjectWriteFileInput as never, {
      projectId: "proj-123",
      path: "README.md",
      content: "# Hello",
    });
  });
});

// =====================================
// provider.ts
// =====================================
describe("provider schemas round-trip", () => {
  it("ProviderSessionStartInput with optional modelSelection", () => {
    roundTrip(ProviderSessionStartInput as never, {
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
    });
    roundTrip(ProviderSessionStartInput as never, {
      threadId: "thread-1",
      provider: "claudeAgent",
      cwd: "/tmp/workspace",
      modelSelection: { provider: "anthropic", model: "claude-sonnet-4" },
      runtimeMode: "full-access",
    });
  });

  it("ProviderSendTurnInput with message", () => {
    roundTrip(ProviderSendTurnInput as never, {
      threadId: "thread-1",
      turnId: "turn-1",
      message: "Hello, can you help me refactor this?",
    });
  });

  it("ProviderTurnStartResult", () => {
    roundTrip(ProviderTurnStartResult as never, {
      sessionId: "session-1",
      turnId: "turn-1",
      cwd: "/tmp/workspace",
    });
  });
});

// =====================================
// providerInstance.ts
// =====================================
describe("providerInstance schemas round-trip", () => {
  it("ProviderDriverKind branded string", () => {
    expect(decodeOnly(ProviderDriverKind as never, "codex")).toBe("codex");
  });

  it("ProviderInstanceId branded string", () => {
    expect(decodeOnly(ProviderInstanceId as never, "codex_work")).toBe("codex_work");
  });

  it("ProviderInstanceRef struct", () => {
    roundTrip(ProviderInstanceRef as never, {
      driver: "codex",
      instanceId: "codex_personal",
    });
  });

  it("ProviderInstanceConfig with displayName and config", () => {
    roundTrip(ProviderInstanceConfig as never, {
      driver: "codex",
      displayName: "Codex (personal)",
      config: { homePath: "/home/user/.codex" },
    });
  });
});

// =====================================
// providerRuntime.ts
// =====================================
describe("providerRuntime schemas round-trip", () => {
  it("ProviderRuntimeTurnStatus literals", () => {
    roundTrip(ProviderRuntimeTurnStatus as never, "active");
    roundTrip(ProviderRuntimeTurnStatus as never, "interrupted");
    roundTrip(ProviderRuntimeTurnStatus as never, "completed");
  });

  it("ProviderRuntimeEvent session.started", () => {
    roundTrip(ProviderRuntimeEvent as never, {
      type: "session.started",
      eventId: "event-1",
      provider: "codex",
      providerInstanceId: "codex_personal",
      createdAt: "2026-04-10T00:00:00.000Z",
      threadId: "thread-1",
      payload: { message: "started" },
    });
  });
});

// =====================================
// remoteAccess.ts
// =====================================
describe("remoteAccess schemas round-trip", () => {
  it("AdvertisedEndpointProviderKind literals", () => {
    roundTrip(AdvertisedEndpointProviderKind as never, "tailscale");
    roundTrip(AdvertisedEndpointProviderKind as never, "cloudflare");
    roundTrip(AdvertisedEndpointProviderKind as never, "ngrok");
  });

  it("AdvertisedEndpointReachability literals", () => {
    roundTrip(AdvertisedEndpointReachability as never, "reachable");
    roundTrip(AdvertisedEndpointReachability as never, "unreachable");
    roundTrip(AdvertisedEndpointReachability as never, "unknown");
  });

  it("AdvertisedEndpoint struct", () => {
    roundTrip(AdvertisedEndpoint as never, {
      url: "https://my-t3code.ts.net",
      host: "my-t3code",
      provider: "tailscale",
      reachability: "reachable",
    });
  });
});

// =====================================
// server.ts
// =====================================
describe("server schemas round-trip", () => {
  it("ServerProviderAuth with optional error", () => {
    roundTrip(ServerProviderAuth as never, { status: "authenticated" });
    roundTrip(ServerProviderAuth as never, { status: "error", error: "Token expired" });
  });

  it("ServerProviderModel with capabilities", () => {
    roundTrip(ServerProviderModel as never, {
      id: "gpt-4o",
      displayName: "GPT-4o",
      capabilities: { maxTokens: 128000 },
    });
  });

  it("ServerProvider with minimal fields", () => {
    roundTrip(ServerProvider as never, {
      instanceId: "codex_personal",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });
  });
});

// =====================================
// settings.ts
// =====================================
describe("settings schemas round-trip", () => {
  it("TimestampFormat literals", () => {
    roundTrip(TimestampFormat as never, "locale");
    roundTrip(TimestampFormat as never, "12-hour");
    roundTrip(TimestampFormat as never, "24-hour");
  });

  it("ClientSettingsSchema with sidebar config", () => {
    roundTrip(ClientSettingsSchema as never, {
      timestampFormat: "24-hour",
      sidebar: {
        projectSortOrder: "updated_at",
        threadSortOrder: "updated_at",
        projectGroupingMode: "workspace",
        threadPreviewCount: 3,
      },
    });
  });
});

// =====================================
// sourceControl.ts
// =====================================
describe("sourceControl schemas round-trip", () => {
  it("SourceControlProviderKind literals", () => {
    roundTrip(SourceControlProviderKind as never, "github");
    roundTrip(SourceControlProviderKind as never, "gitlab");
    roundTrip(SourceControlProviderKind as never, "bitbucket");
  });

  it("SourceControlRepositoryLookupInput", () => {
    roundTrip(SourceControlRepositoryLookupInput as never, {
      remote: "origin",
      cwd: "/repo",
    });
  });

  it("SourceControlRepositoryInfo with clone URLs", () => {
    roundTrip(SourceControlRepositoryInfo as never, {
      name: "my-repo",
      owner: "my-org",
      host: "github.com",
      visibility: "public",
      cloneUrls: { https: "https://github.com/my-org/my-repo.git" },
      defaultBranch: "main",
    });
  });
});

// =====================================
// terminal.ts
// =====================================
describe("terminal schemas round-trip", () => {
  it("TerminalOpenInput with dimensions", () => {
    roundTrip(TerminalOpenInput as never, {
      threadId: "thread-1",
      cwd: "/tmp/project",
      cols: 120,
      rows: 40,
    });
  });

  it("TerminalWriteInput", () => {
    roundTrip(TerminalWriteInput as never, {
      threadId: "thread-1",
      terminalId: "terminal-1",
      data: "ls -la\n",
    });
  });

  it("TerminalResizeInput", () => {
    roundTrip(TerminalResizeInput as never, {
      threadId: "thread-1",
      terminalId: "terminal-1",
      cols: 100,
      rows: 30,
    });
  });

  it("TerminalEvent data event", () => {
    roundTrip(TerminalEvent as never, {
      type: "data",
      eventId: "term-event-1",
      terminalId: "terminal-1",
      createdAt: "2026-04-10T00:00:00.000Z",
      payload: { data: "hello\n" },
    });
  });

  it("TerminalSessionSnapshot", () => {
    roundTrip(TerminalSessionSnapshot as never, {
      terminalId: "terminal-1",
      status: "open",
      cwd: "/tmp/project",
    });
  });
});

// =====================================
// vcs.ts
// =====================================
describe("vcs schemas round-trip", () => {
  it("VcsDriverKind literals", () => {
    roundTrip(VcsDriverKind as never, "git");
    roundTrip(VcsDriverKind as never, "hg");
  });

  it("VcsFreshness with optional timestamp", () => {
    roundTrip(VcsFreshness as never, { source: "cache", timestamp: "2026-04-10T00:00:00.000Z" });
    roundTrip(VcsFreshness as never, { source: "live" });
  });
});

// =====================================
// ipc.ts
// =====================================
describe("ipc schemas round-trip", () => {
  it("ContextMenuItemSchema with submenu", () => {
    roundTrip(ContextMenuItemSchema as never, {
      label: "Open File",
      action: "openFile",
    });
    roundTrip(ContextMenuItemSchema as never, {
      label: "Submenu",
      submenu: [
        { label: "Option A", action: "optionA" },
        { label: "Option B", action: "optionB" },
      ],
    });
  });

  it("DesktopThemeSchema literals", () => {
    roundTrip(DesktopThemeSchema as never, "light");
    roundTrip(DesktopThemeSchema as never, "dark");
    roundTrip(DesktopThemeSchema as never, "system");
  });

  it("DesktopUpdateStatusSchema literals", () => {
    roundTrip(DesktopUpdateStatusSchema as never, "idle");
    roundTrip(DesktopUpdateStatusSchema as never, "checking");
    roundTrip(DesktopUpdateStatusSchema as never, "downloading");
    roundTrip(DesktopUpdateStatusSchema as never, "ready");
  });
});

// =====================================
// desktopBootstrap.ts
// =====================================
describe("desktopBootstrap schemas round-trip", () => {
  it("DesktopBackendBootstrap with workspace paths", () => {
    roundTrip(DesktopBackendBootstrap as never, {
      serverUrl: "http://localhost:3000",
      workspacePaths: ["/home/user/projects"],
    });
  });
});

// =====================================
// rpc.ts
// =====================================
describe("rpc schemas round-trip", () => {
  it("WsTerminalOpenRpc", () => {
    roundTrip(WsTerminalOpenRpc as never, {
      method: "terminal.open",
      params: { threadId: "thread-1", cwd: "/tmp/project", cols: 120, rows: 40 },
    });
  });

  it("WsTerminalWriteRpc", () => {
    roundTrip(WsTerminalWriteRpc as never, {
      method: "terminal.write",
      params: { threadId: "thread-1", terminalId: "terminal-1", data: "echo hello\n" },
    });
  });
});
