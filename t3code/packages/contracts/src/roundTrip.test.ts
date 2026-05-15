import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  AuthAccessStreamEvent,
  AuthSessionState,
  ClientOrchestrationCommand,
  ClientSettingsSchema,
  ContextMenuItemSchema,
  DesktopBackendBootstrap,
  DesktopSshEnvironmentBootstrapSchema,
  DesktopUpdateStateSchema,
  ExecutionEnvironmentDescriptor,
  FilesystemBrowseResult,
  GitRunStackedActionInput,
  LaunchEditorInput,
  ModelCapabilities,
  ModelSelection,
  ProjectSearchEntriesResult,
  ProviderEvent,
  ProviderInstanceConfigMap,
  ProviderRuntimeEvent,
  ProviderSessionStartInput,
  ResolvedKeybindingsConfig,
  ServerConfig,
  ServerProvider,
  ServerSettings,
  ServerSettingsPatch,
  SourceControlCloneRepositoryInput,
  SourceControlPublishRepositoryResult,
  TerminalEvent,
  VcsDriverCapabilities,
  VcsListRefsResult,
  VcsStatusResult,
  AdvertisedEndpoint,
} from "./index.ts";

const ISO = "2026-02-28T00:00:00.000Z";
const DATE_TIME = DateTime.makeUnsafe(ISO);

type RoundTripCase = {
  readonly name: string;
  readonly schema: Schema.Top;
  readonly input: unknown;
};

const authDescriptor = {
  policy: "remote-reachable",
  bootstrapMethods: ["desktop-bootstrap", "one-time-token"],
  sessionMethods: ["browser-session-cookie", "bearer-session-token"],
  sessionCookieName: "t3_session",
};

const environmentDescriptor = {
  environmentId: "env-local",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.24",
  capabilities: { repositoryIdentity: true },
};

const modelSelection = {
  instanceId: "codex_personal",
  model: "gpt-5.4",
  options: {
    reasoning: "high",
    webSearch: true,
  },
};

const serverProvider = {
  instanceId: "codex_personal",
  driver: "codex",
  displayName: "Codex Personal",
  enabled: true,
  installed: true,
  version: "0.1.0",
  status: "ready",
  auth: {
    status: "authenticated",
    type: "oauth",
    label: "Codex",
  },
  checkedAt: ISO,
  models: [
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoning",
            label: "Reasoning",
            type: "select",
            options: [{ id: "high", label: "High", isDefault: true }],
            currentValue: "high",
          },
        ],
      },
    },
  ],
};

const cases: ReadonlyArray<RoundTripCase> = [
  {
    name: "auth access stream event",
    schema: AuthAccessStreamEvent,
    input: {
      version: 1,
      revision: 7,
      type: "snapshot",
      payload: {
        pairingLinks: [
          {
            id: "pairing-1",
            credential: "credential-1",
            role: "owner",
            subject: "owner",
            createdAt: DATE_TIME,
            expiresAt: DATE_TIME,
          },
        ],
        clientSessions: [
          {
            sessionId: "session-1",
            subject: "desktop",
            role: "client",
            method: "bearer-session-token",
            client: {
              label: "Workstation",
              ipAddress: "127.0.0.1",
              userAgent: "T3 Desktop",
              deviceType: "desktop",
              os: "macOS",
              browser: "Chrome",
            },
            issuedAt: DATE_TIME,
            expiresAt: DATE_TIME,
            lastConnectedAt: DATE_TIME,
            connected: true,
            current: false,
          },
        ],
      },
    },
  },
  {
    name: "auth session state",
    schema: AuthSessionState,
    input: {
      authenticated: true,
      auth: authDescriptor,
      role: "owner",
      sessionMethod: "browser-session-cookie",
      expiresAt: DATE_TIME,
    },
  },
  {
    name: "desktop backend bootstrap",
    schema: DesktopBackendBootstrap,
    input: {
      mode: "desktop",
      noBrowser: false,
      port: 4096,
      t3Home: "/tmp/t3",
      host: "127.0.0.1",
      desktopBootstrapToken: "bootstrap-token",
      tailscaleServeEnabled: false,
      tailscaleServePort: 4097,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
    },
  },
  {
    name: "execution environment descriptor",
    schema: ExecutionEnvironmentDescriptor,
    input: environmentDescriptor,
  },
  {
    name: "advertised endpoint",
    schema: AdvertisedEndpoint,
    input: {
      id: "endpoint-1",
      label: "Local endpoint",
      provider: {
        id: "core",
        label: "Core",
        kind: "core",
        isAddon: false,
      },
      httpBaseUrl: "http://127.0.0.1:4096",
      wsBaseUrl: "ws://127.0.0.1:4096",
      reachability: "loopback",
      compatibility: {
        hostedHttpsApp: "requires-configuration",
        desktopApp: "compatible",
      },
      source: "server",
      status: "available",
      isDefault: true,
      description: "Local T3 endpoint",
    },
  },
  {
    name: "desktop update state",
    schema: DesktopUpdateStateSchema,
    input: {
      enabled: true,
      status: "available",
      channel: "latest",
      currentVersion: "0.0.24",
      hostArch: "arm64",
      appArch: "arm64",
      runningUnderArm64Translation: false,
      availableVersion: "0.0.25",
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: ISO,
      message: "Update available",
      errorContext: null,
      canRetry: true,
    },
  },
  {
    name: "desktop ssh bootstrap",
    schema: DesktopSshEnvironmentBootstrapSchema,
    input: {
      target: {
        alias: "prod",
        hostname: "example.com",
        username: "alice",
        port: 22,
      },
      httpBaseUrl: "http://127.0.0.1:4096",
      wsBaseUrl: "ws://127.0.0.1:4096",
      pairingToken: "pairing-token",
      remotePort: 4096,
      remoteServerKind: "managed",
    },
  },
  {
    name: "context menu item",
    schema: ContextMenuItemSchema,
    input: {
      id: "copy",
      label: "Copy",
      children: [{ id: "copy-path", label: "Copy path", disabled: false }],
    },
  },
  {
    name: "terminal event",
    schema: TerminalEvent,
    input: {
      type: "started",
      threadId: "thread-1",
      terminalId: "default",
      createdAt: ISO,
      snapshot: {
        threadId: "thread-1",
        terminalId: "default",
        cwd: "/repo",
        worktreePath: null,
        status: "running",
        pid: 1234,
        history: "",
        exitCode: null,
        exitSignal: null,
        updatedAt: ISO,
      },
    },
  },
  {
    name: "provider session start input",
    schema: ProviderSessionStartInput,
    input: {
      threadId: "thread-1",
      provider: "codex",
      providerInstanceId: "codex_personal",
      cwd: "/repo",
      modelSelection,
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      runtimeMode: "full-access",
    },
  },
  {
    name: "provider event",
    schema: ProviderEvent,
    input: {
      id: "event-1",
      kind: "request",
      provider: "codex",
      providerInstanceId: "codex_personal",
      threadId: "thread-1",
      createdAt: ISO,
      method: "approval.requested",
      turnId: "turn-1",
      requestId: "approval-1",
      requestKind: "command",
      payload: { command: "npm test" },
    },
  },
  {
    name: "provider instance config map",
    schema: ProviderInstanceConfigMap,
    input: {
      codex_personal: {
        driver: "codex",
        displayName: "Codex Personal",
        accentColor: "#009688",
        environment: [
          {
            name: "OPENAI_API_KEY",
            value: "",
            sensitive: true,
            valueRedacted: true,
          },
        ],
        enabled: true,
        config: { homePath: "~/.codex-personal" },
      },
    },
  },
  {
    name: "provider runtime event",
    schema: ProviderRuntimeEvent,
    input: {
      type: "user-input.resolved",
      eventId: "runtime-event-1",
      provider: "codex",
      providerInstanceId: "codex_personal",
      threadId: "thread-1",
      requestId: "request-1",
      createdAt: ISO,
      payload: {
        answers: { sandbox_mode: "workspace-write" },
      },
    },
  },
  {
    name: "model capabilities",
    schema: ModelCapabilities,
    input: {
      optionDescriptors: [
        {
          id: "reasoning",
          label: "Reasoning",
          type: "select",
          options: [{ id: "medium", label: "Medium", isDefault: true }],
          currentValue: "medium",
          promptInjectedValues: ["medium"],
        },
        {
          id: "webSearch",
          label: "Web search",
          type: "boolean",
          currentValue: true,
        },
      ],
    },
  },
  {
    name: "resolved keybindings config",
    schema: ResolvedKeybindingsConfig,
    input: [
      {
        command: "terminal.toggle",
        shortcut: {
          key: "`",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
        whenAst: { type: "identifier", name: "terminalFocus" },
      },
    ],
  },
  {
    name: "server provider",
    schema: ServerProvider,
    input: serverProvider,
  },
  {
    name: "server config",
    schema: ServerConfig,
    input: {
      environment: environmentDescriptor,
      auth: authDescriptor,
      cwd: "/repo",
      keybindingsConfigPath: "/repo/keybindings.json",
      keybindings: [],
      issues: [],
      providers: [serverProvider],
      availableEditors: ["vscode"],
      observability: {
        logsDirectoryPath: "/repo/.t3/logs",
        localTracingEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpTracesEnabled: true,
        otlpMetricsEnabled: false,
      },
      settings: {},
    },
  },
  {
    name: "client settings",
    schema: ClientSettingsSchema,
    input: {
      autoOpenPlanSidebar: false,
      confirmThreadArchive: true,
      favorites: [{ provider: "codex_personal", model: "gpt-5.4" }],
      sidebarThreadPreviewCount: 3,
    },
  },
  {
    name: "server settings",
    schema: ServerSettings,
    input: {
      providerInstances: {
        codex_personal: {
          driver: "codex",
          config: { homePath: "~/.codex-personal" },
        },
      },
    },
  },
  {
    name: "server settings patch",
    schema: ServerSettingsPatch,
    input: {
      addProjectBaseDirectory: "  ~/Development  ",
      providerInstances: {
        codex_personal: { driver: "codex", displayName: "Codex Personal" },
      },
    },
  },
  {
    name: "git stacked action input",
    schema: GitRunStackedActionInput,
    input: {
      actionId: "action-1",
      cwd: "/repo",
      action: "commit_push_pr",
      commitMessage: "Add schema round-trip tests",
      featureBranch: true,
      filePaths: ["packages/contracts/src/roundTrip.test.ts"],
    },
  },
  {
    name: "vcs status result",
    schema: VcsStatusResult,
    input: {
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature/contracts",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "packages/contracts/src/roundTrip.test.ts", insertions: 12, deletions: 0 }],
        insertions: 12,
        deletions: 0,
      },
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      aheadOfDefaultCount: 1,
      pr: {
        number: 827,
        title: "Add round-trip schema validation tests",
        url: "https://github.com/UnsafeLabs/Bounty-Hunters/pull/827",
        baseRef: "main",
        headRef: "feature/contracts",
        state: "open",
      },
    },
  },
  {
    name: "vcs refs result",
    schema: VcsListRefsResult,
    input: {
      refs: [
        {
          name: "main",
          current: false,
          isDefault: true,
          worktreePath: null,
        },
        {
          name: "feature/contracts",
          isRemote: true,
          remoteName: "origin",
          current: true,
          isDefault: false,
          worktreePath: "/repo",
        },
      ],
      isRepo: true,
      hasPrimaryRemote: true,
      nextCursor: null,
      totalCount: 2,
    },
  },
  {
    name: "vcs driver capabilities",
    schema: VcsDriverCapabilities,
    input: {
      kind: "git",
      supportsWorktrees: true,
      supportsBookmarks: false,
      supportsAtomicSnapshot: false,
      supportsPushDefaultRemote: true,
      ignoreClassifier: "native",
    },
  },
  {
    name: "source control clone input",
    schema: SourceControlCloneRepositoryInput,
    input: {
      provider: "github",
      repository: "UnsafeLabs/Bounty-Hunters",
      destinationPath: "/tmp/bounty-hunters",
      protocol: "https",
    },
  },
  {
    name: "source control publish result",
    schema: SourceControlPublishRepositoryResult,
    input: {
      repository: {
        provider: "github",
        nameWithOwner: "jynbil1/Bounty-Hunters",
        url: "https://github.com/jynbil1/Bounty-Hunters",
        sshUrl: "git@github.com:jynbil1/Bounty-Hunters.git",
      },
      remoteName: "origin",
      remoteUrl: "git@github.com:jynbil1/Bounty-Hunters.git",
      branch: "codex-round-trip-tests",
      upstreamBranch: "origin/codex-round-trip-tests",
      status: "pushed",
    },
  },
  {
    name: "orchestration model selection",
    schema: ModelSelection,
    input: {
      provider: "codex",
      model: "gpt-5.4",
      options: {
        reasoning: "high",
        webSearch: true,
      },
    },
  },
  {
    name: "client orchestration command",
    schema: ClientOrchestrationCommand,
    input: {
      type: "project.create",
      commandId: "command-1",
      projectId: "project-1",
      title: "Contracts",
      workspaceRoot: "/repo",
      createWorkspaceRootIfMissing: false,
      defaultModelSelection: modelSelection,
      createdAt: ISO,
    },
  },
  {
    name: "editor launch input",
    schema: LaunchEditorInput,
    input: {
      cwd: "/repo",
      editor: "vscode",
    },
  },
  {
    name: "project search result",
    schema: ProjectSearchEntriesResult,
    input: {
      entries: [
        {
          path: "packages/contracts/src/roundTrip.test.ts",
          kind: "file",
          parentPath: "packages/contracts/src",
        },
      ],
      truncated: false,
    },
  },
  {
    name: "filesystem browse result",
    schema: FilesystemBrowseResult,
    input: {
      parentPath: "/repo/packages/contracts/src",
      entries: [
        {
          name: "roundTrip.test.ts",
          fullPath: "/repo/packages/contracts/src/roundTrip.test.ts",
        },
      ],
    },
  },
];

function expectSchemaRoundTrip(schema: Schema.Top, input: unknown) {
  const decode = Schema.decodeUnknownSync(schema);
  const encode = Schema.encodeSync(schema);
  const decoded = decode(input);
  const encoded = encode(decoded);
  const decodedAgain = decode(encoded);

  expect(encode(decodedAgain)).toEqual(encoded);
}

describe("contract schema round trips", () => {
  it.each(cases)("$name", ({ schema, input }) => {
    expectSchemaRoundTrip(schema, input);
  });
});
