import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import * as FastCheck from "effect/testing/FastCheck";

import * as Auth from "./auth.ts";
import * as DesktopBootstrap from "./desktopBootstrap.ts";
import * as Editor from "./editor.ts";
import * as Environment from "./environment.ts";
import * as Filesystem from "./filesystem.ts";
import * as Git from "./git.ts";
import * as Ipc from "./ipc.ts";
import * as Keybindings from "./keybindings.ts";
import * as Model from "./model.ts";
import * as Orchestration from "./orchestration.ts";
import * as Project from "./project.ts";
import * as Provider from "./provider.ts";
import * as ProviderInstance from "./providerInstance.ts";
import * as ProviderRuntime from "./providerRuntime.ts";
import * as RemoteAccess from "./remoteAccess.ts";
import * as Server from "./server.ts";
import * as Settings from "./settings.ts";
import * as SourceControl from "./sourceControl.ts";
import * as Terminal from "./terminal.ts";
import * as Vcs from "./vcs.ts";

const CONTRACT_MODULES = {
  auth: Auth,
  desktopBootstrap: DesktopBootstrap,
  editor: Editor,
  environment: Environment,
  filesystem: Filesystem,
  git: Git,
  ipc: Ipc,
  keybindings: Keybindings,
  model: Model,
  orchestration: Orchestration,
  project: Project,
  provider: Provider,
  providerInstance: ProviderInstance,
  providerRuntime: ProviderRuntime,
  remoteAccess: RemoteAccess,
  server: Server,
  settings: Settings,
  sourceControl: SourceControl,
  terminal: Terminal,
  vcs: Vcs,
} satisfies Record<string, Record<string, unknown>>;

const ARBITRARY_SKIP = new Set([
  "keybindings.KeybindingRule",
  "keybindings.ResolvedKeybindingRule",
  "keybindings.SCRIPT_RUN_COMMAND_PATTERN",
  "orchestration.OrchestrationReadModel",
  "orchestration.OrchestrationShellSnapshot",
  "server.ServerConfig",
  "server.ServerConfigProviderStatusesPayload",
  "server.ServerConfigSettingsUpdatedPayload",
  "server.ServerConfigStreamEvent",
  "server.ServerConfigStreamProviderStatusesEvent",
  "server.ServerConfigStreamSettingsUpdatedEvent",
  "server.ServerConfigStreamSnapshotEvent",
  "server.ServerConfigUpdatedPayload",
  "server.ServerProviderUpdatedPayload",
  "server.ServerProviders",
  "server.ServerRemoveKeybindingInput",
  "server.ServerUpsertKeybindingInput",
  "settings.ServerSettings",
]);

type NamedSchema = readonly [name: string, schema: Schema.Top];

function isSchema(value: unknown): value is Schema.Top {
  return typeof value === "object" && value !== null && "ast" in value;
}

function collectExportedSchemas(): ReadonlyArray<NamedSchema> {
  return Object.entries(CONTRACT_MODULES).flatMap(([moduleName, moduleExports]) =>
    Object.entries(moduleExports).flatMap(([exportName, value]) =>
      isSchema(value) ? [[`${moduleName}.${exportName}`, value] as const] : [],
    ),
  );
}

function encodeSync(schema: Schema.Top): (input: unknown) => unknown {
  return Schema.encodeSync(schema as never) as unknown as (input: unknown) => unknown;
}

function decodeUnknownSync(schema: Schema.Top): (input: unknown) => unknown {
  return Schema.decodeUnknownSync(schema as never) as (input: unknown) => unknown;
}

function expectTypeRoundTrip(name: string, schema: Schema.Top, value: unknown): void {
  const encode = encodeSync(schema);
  const decode = decodeUnknownSync(schema);
  const encoded = encode(value);
  const decoded = decode(encoded);
  const reencoded = encode(decoded);
  expect(reencoded, name).toEqual(encoded);
}

function expectEncodedRoundTrip(name: string, schema: Schema.Top, encoded: unknown): void {
  const encode = encodeSync(schema);
  const decode = decodeUnknownSync(schema);
  const decoded = decode(encoded);
  const reencoded = encode(decoded);
  const decodedAgain = decode(reencoded);
  expect(reencoded, name).toEqual(encoded);
  expect(decodedAgain, name).toEqual(decoded);
}

const exportedSchemas = collectExportedSchemas();
const generatedRoundTripSchemas = exportedSchemas.filter(([name]) => !ARBITRARY_SKIP.has(name));

const sampleProvider = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [
    {
      slug: "gpt-5.4",
      name: "GPT 5.4",
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [
    {
      name: "help",
      description: "Show help",
      input: { hint: "question" },
    },
  ],
  skills: [
    {
      name: "review",
      description: "Review current changes",
      path: "/skills/review",
      enabled: true,
    },
  ],
};

const sampleResolvedKeybinding = {
  command: "script.test-run.run",
  shortcut: {
    key: "K",
    metaKey: true,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    modKey: true,
  },
  whenAst: {
    type: "and",
    left: { type: "identifier", name: "editorFocus" },
    right: {
      type: "not",
      node: { type: "identifier", name: "inputFocus" },
    },
  },
};

const sampleKeybindingRule = {
  key: "Meta+K",
  command: "commandPalette.toggle",
  when: "editorFocus",
};

const sampleEnvironment = {
  environmentId: "env-local",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "1.0.0",
  capabilities: { repositoryIdentity: true },
};

const sampleAuth = {
  policy: "desktop-managed-local",
  bootstrapMethods: ["desktop-bootstrap"],
  sessionMethods: ["browser-session-cookie"],
  sessionCookieName: "t3code.sid",
};

const sampleObservability = {
  logsDirectoryPath: "/tmp/t3code/logs",
  localTracingEnabled: false,
  otlpTracesEnabled: false,
  otlpMetricsEnabled: false,
};

const sampleServerSettings = Settings.DEFAULT_SERVER_SETTINGS;

const sampleServerConfig = {
  environment: sampleEnvironment,
  auth: sampleAuth,
  cwd: "/tmp/t3code",
  keybindingsConfigPath: "/tmp/t3code/keybindings.json",
  keybindings: [sampleResolvedKeybinding],
  issues: [],
  providers: [sampleProvider],
  availableEditors: ["cursor", "vscode"],
  observability: sampleObservability,
  settings: sampleServerSettings,
};

const sampleProject = {
  id: "project-unicode",
  title: "Unicode プロジェクト 🚀",
  workspaceRoot: "/tmp/t3code/unicode",
  defaultModelSelection: {
    instanceId: "codex",
    model: "gpt-5.4",
  },
  scripts: [
    {
      id: "test",
      name: "Run tests",
      command: "bun test",
      icon: "test",
      runOnWorktreeCreate: false,
    },
  ],
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
  deletedAt: null,
};

const sampleThread = {
  id: "thread-1",
  projectId: sampleProject.id,
  title: "Schema validation",
  modelSelection: {
    instanceId: "codex",
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const sampleProjectShell = {
  id: sampleProject.id,
  title: sampleProject.title,
  workspaceRoot: sampleProject.workspaceRoot,
  defaultModelSelection: sampleProject.defaultModelSelection,
  scripts: sampleProject.scripts,
  createdAt: sampleProject.createdAt,
  updatedAt: sampleProject.updatedAt,
};

const sampleThreadShell = {
  id: sampleThread.id,
  projectId: sampleThread.projectId,
  title: sampleThread.title,
  modelSelection: sampleThread.modelSelection,
  runtimeMode: sampleThread.runtimeMode,
  interactionMode: sampleThread.interactionMode,
  branch: sampleThread.branch,
  worktreePath: sampleThread.worktreePath,
  latestTurn: sampleThread.latestTurn,
  createdAt: sampleThread.createdAt,
  updatedAt: sampleThread.updatedAt,
  archivedAt: sampleThread.archivedAt,
  session: sampleThread.session,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const manualRoundTripCases: ReadonlyArray<readonly [string, Schema.Top, unknown]> = [
  ["keybindings.KeybindingRule", Keybindings.KeybindingRule, sampleKeybindingRule],
  [
    "keybindings.ResolvedKeybindingRule",
    Keybindings.ResolvedKeybindingRule,
    sampleResolvedKeybinding,
  ],
  [
    "keybindings.SCRIPT_RUN_COMMAND_PATTERN",
    Keybindings.SCRIPT_RUN_COMMAND_PATTERN,
    "script.test-run.run",
  ],
  [
    "orchestration.OrchestrationReadModel",
    Orchestration.OrchestrationReadModel,
    {
      snapshotSequence: 1,
      projects: [sampleProject],
      threads: [sampleThread],
      updatedAt: "2026-04-10T00:00:00.000Z",
    },
  ],
  [
    "orchestration.OrchestrationShellSnapshot",
    Orchestration.OrchestrationShellSnapshot,
    {
      snapshotSequence: 1,
      projects: [sampleProjectShell],
      threads: [sampleThreadShell],
      updatedAt: "2026-04-10T00:00:00.000Z",
    },
  ],
  ["server.ServerConfig", Server.ServerConfig, sampleServerConfig],
  [
    "server.ServerConfigProviderStatusesPayload",
    Server.ServerConfigProviderStatusesPayload,
    { providers: [sampleProvider] },
  ],
  [
    "server.ServerConfigSettingsUpdatedPayload",
    Server.ServerConfigSettingsUpdatedPayload,
    { settings: sampleServerSettings },
  ],
  [
    "server.ServerConfigStreamEvent",
    Server.ServerConfigStreamEvent,
    { version: 1, type: "snapshot", config: sampleServerConfig },
  ],
  [
    "server.ServerConfigStreamProviderStatusesEvent",
    Server.ServerConfigStreamProviderStatusesEvent,
    { version: 1, type: "providerStatuses", payload: { providers: [sampleProvider] } },
  ],
  [
    "server.ServerConfigStreamSettingsUpdatedEvent",
    Server.ServerConfigStreamSettingsUpdatedEvent,
    { version: 1, type: "settingsUpdated", payload: { settings: sampleServerSettings } },
  ],
  [
    "server.ServerConfigStreamSnapshotEvent",
    Server.ServerConfigStreamSnapshotEvent,
    { version: 1, type: "snapshot", config: sampleServerConfig },
  ],
  [
    "server.ServerConfigUpdatedPayload",
    Server.ServerConfigUpdatedPayload,
    { issues: [], providers: [sampleProvider], settings: sampleServerSettings },
  ],
  [
    "server.ServerProviderUpdatedPayload",
    Server.ServerProviderUpdatedPayload,
    { providers: [sampleProvider] },
  ],
  ["server.ServerProviders", Server.ServerProviders, [sampleProvider]],
  ["server.ServerRemoveKeybindingInput", Server.ServerRemoveKeybindingInput, sampleKeybindingRule],
  [
    "server.ServerUpsertKeybindingInput",
    Server.ServerUpsertKeybindingInput,
    { ...sampleKeybindingRule, replace: sampleKeybindingRule },
  ],
  ["settings.ServerSettings", Settings.ServerSettings, sampleServerSettings],
];

describe("contract schema round-trip coverage", () => {
  it("keeps the manual fallback list aligned with generated schema coverage", () => {
    const schemaNames = new Set(exportedSchemas.map(([name]) => name));
    for (const name of ARBITRARY_SKIP) {
      expect(schemaNames.has(name), name).toBe(true);
    }
    expect(manualRoundTripCases.map(([name]) => name).sort()).toEqual([...ARBITRARY_SKIP].sort());
  });

  it.each(generatedRoundTripSchemas)(
    "%s generated sample encode/decode round-trips",
    (name, schema) => {
      const [sample] = FastCheck.sample(Schema.toArbitrary(schema), {
        numRuns: 1,
        seed: 827,
      });
      expectTypeRoundTrip(name, schema, sample);
    },
  );

  it.each(manualRoundTripCases)(
    "%s hand-built sample encode/decode round-trips",
    (name, schema, sample) => {
      expectTypeRoundTrip(name, schema, sample);
    },
  );

  it("preserves canonical encoded server settings through decode and encode", () => {
    const encodedSettings = Schema.encodeSync(Settings.ServerSettings)(
      Settings.DEFAULT_SERVER_SETTINGS,
    );
    expectEncodedRoundTrip(
      "settings.ServerSettings canonical encoded value",
      Settings.ServerSettings,
      encodedSettings,
    );
  });
});

describe("contract schema edge cases", () => {
  it("accepts unicode in project names while preserving the encoded shape", () => {
    expectEncodedRoundTrip(
      "orchestration.OrchestrationProject unicode title",
      Orchestration.OrchestrationProject,
      {
        ...sampleProject,
        title: "空白なしの名前",
      },
    );
  });

  it("rejects enum-like schema values outside their allowed set", () => {
    expect(() =>
      Schema.decodeUnknownSync(Keybindings.KeybindingCommand)("unknown.command"),
    ).toThrow(/Expected/);
    expect(() => Schema.decodeUnknownSync(Settings.TimestampFormat)("military")).toThrow(
      /Expected/,
    );
  });

  it("reports paths for invalid nested data", () => {
    expect(() =>
      Schema.decodeUnknownSync(Orchestration.OrchestrationReadModel)({
        snapshotSequence: 1,
        projects: [{ ...sampleProject, id: "" }],
        threads: [],
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    ).toThrow(/projects/);
  });
});
