import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { AuthSessionId, EnvironmentId, ProjectId, ThreadId, PositiveInt, TrimmedNonEmptyString, PortSchema } from "./baseSchemas.ts";

import {
  AuthStrategy,
  AuthConfig,
  AuthServerPublicConfig,
  AuthAccessStreamEvent,
  AuthSessionRequest,
} from "./auth.ts";
import { DesktopBackendBootstrap } from "./desktopBootstrap.ts";
import {
  ExecutionEnvironmentPlatformOs,
  ExecutionEnvironmentPlatformArch,
  EnvironmentPlatform,
  EnvironmentBootstrap,
} from "./environment.ts";
import {
  AdvertisedEndpointProviderKind,
  PeerAdvertisedEndpoint,
  AdvertisedEndpoint,
} from "./remoteAccess.ts";
import { EditorLaunchStyle } from "./editor.ts";
import { ProviderOptionDescriptor, ProviderModelDescriptor, ModelSelection } from "./model.ts";
import { ProjectSearchEntriesInput, ProjectSearchEntry } from "./project.ts";
import { FilesystemBrowseInput } from "./filesystem.ts";
import { VcsProviderKind } from "./vcs.ts";
import { KeyBindingAction, KeyBindingActionGroup, KeyBinding } from "./keybindings.ts";
import { ServerSettings, ServerEnv, ClientEnv } from "./settings.ts";
import { ProviderCommand } from "./provider.ts";
import { ProviderInstanceId, ProviderInstance } from "./providerInstance.ts";
import { ProviderRuntimeCommand } from "./providerRuntime.ts";
import { GitAuthState, GitRemote } from "./git.ts";
import { SourceControlProvider, SourceControlStatus } from "./sourceControl.ts";
import { TerminalCommand } from "./terminal.ts";
import { OrchestrationCommand, OrchestrationEvent } from "./orchestration.ts";

const roundTrip = <A, I, R>(schema: Schema.Schema<A, I, R>, input: I) => {
  const decode = Schema.decodeUnknownSync(schema);
  const encode = Schema.encodeSync(schema);
  const decoded = decode(input);
  const encoded = encode(decoded);
  expect(encoded).toEqual(input);
};

const roundTripFail = <A, I, R>(schema: Schema.Schema<A, I, R>, input: unknown) => {
  const decode = Schema.decodeUnknownSync(schema);
  expect(() => decode(input)).toThrow();
};

function describeSchema<T extends string>(name: string, schema: Schema.Schema<any, any, any>, validInputs: unknown[], invalidInputs?: unknown[]) {
  describe(name, () => {
    it.each(validInputs)("round-trips: %j", (input) => {
      roundTrip(schema, input);
    });
    if (invalidInputs) {
      it.each(invalidInputs)("rejects: %j", (input) => {
        roundTripFail(schema, input);
      });
    }
  });
}

// ---- Base Schemas ----
describe("AuthSessionId", () => {
  it("round-trips valid session id", () => roundTrip(AuthSessionId, "session-123"));
  it("round-trips UUID session id", () => roundTrip(AuthSessionId, "550e8400-e29b-41d4-a716-446655440000"));
});

describe("EnvironmentId", () => {
  it("round-trips", () => roundTrip(EnvironmentId, "env-001"));
});

describe("ProjectId", () => {
  it("round-trips", () => roundTrip(ProjectId, "proj-xyz"));
});

describe("ThreadId", () => {
  it("round-trips", () => roundTrip(ThreadId, "thread-main"));
});

describe("PositiveInt", () => {
  it("round-trips valid", () => roundTrip(PositiveInt, 42));
  it("rejects zero", () => roundTripFail(PositiveInt, 0));
  it("rejects negative", () => roundTripFail(PositiveInt, -1));
});

describe("TrimmedNonEmptyString", () => {
  it("round-trips normal string", () => roundTrip(TrimmedNonEmptyString, "hello"));
  it("rejects empty string", () => roundTripFail(TrimmedNonEmptyString, ""));
});

describe("PortSchema", () => {
  it("round-trips valid port", () => roundTrip(PortSchema, 8080));
  it("rejects port 0", () => roundTripFail(PortSchema, 0));
  it("rejects negative port", () => roundTripFail(PortSchema, -1));
  it("rejects port > 65535", () => roundTripFail(PortSchema, 70000));
});

// ---- Auth ----
describe("AuthStrategy", () => {
  it("round-trips 'none'", () => roundTrip(AuthStrategy, "none"));
  it("round-trips 'token'", () => roundTrip(AuthStrategy, "token"));
  it("round-trips 'github'", () => roundTrip(AuthStrategy, "github"));
  it("rejects unknown strategy", () => roundTripFail(AuthStrategy, "unknown"));
});

describe("AuthConfig", () => {
  it("round-trips minimal config", () => roundTrip(AuthConfig, { strategy: "none" }));
  it("round-trips with github config", () => {
    roundTrip(AuthConfig, {
      strategy: "github",
      githubAppName: "my-app",
      githubClientId: "client-123",
      githubClientSecret: "secret-abc",
    });
  });
  it("round-trips with token config", () => {
    roundTrip(AuthConfig, {
      strategy: "token",
      tokens: ["tok1", "tok2"],
    });
  });
});

describe("AuthSessionRequest", () => {
  it("round-trips", () => roundTrip(AuthSessionRequest, { sessionId: "sess-1" }));
});

// ---- DesktopBootstrap ----
describe("DesktopBackendBootstrap", () => {
  it("round-trips", () => {
    roundTrip(DesktopBackendBootstrap, {
      mode: "desktop",
      noBrowser: true,
      port: 3773,
      t3Home: "/home/user/.t3",
      host: "127.0.0.1",
      desktopBootstrapToken: "tok-xyz",
    });
  });
});

// ---- Environment ----
describe("ExecutionEnvironmentPlatformOs", () => {
  it("round-trips all platforms", () => {
    for (const os of ["darwin", "linux", "windows", "unknown"]) {
      roundTrip(ExecutionEnvironmentPlatformOs, os);
    }
  });
  it("rejects invalid OS", () => roundTripFail(ExecutionEnvironmentPlatformOs, "freebsd"));
});

describe("ExecutionEnvironmentPlatformArch", () => {
  it("round-trips all archs", () => {
    for (const arch of ["x86_64", "aarch64", "arm64", "unknown"]) {
      roundTrip(ExecutionEnvironmentPlatformArch, arch);
    }
  });
});

// ---- RemoteAccess ----
describe("AdvertisedEndpointProviderKind", () => {
  it("round-trips all kinds", () => {
    for (const kind of ["core", "private-network", "tunnel", "manual"]) {
      roundTrip(AdvertisedEndpointProviderKind, kind);
    }
  });
});

describe("PeerAdvertisedEndpoint", () => {
  it("round-trips", () => {
    roundTrip(PeerAdvertisedEndpoint, {
      providerKind: "core",
      providerInstanceId: "inst-1",
      endpoint: "http://localhost:8080",
    });
  });
});

// ---- Editor ----
describe("EditorLaunchStyle", () => {
  it("round-trips all styles", () => {
    for (const style of ["direct-path", "goto", "line-column"]) {
      roundTrip(EditorLaunchStyle, style);
    }
  });
});

// ---- Model ----
describe("ProviderOptionDescriptor", () => {
  it("round-trips string option", () => roundTrip(ProviderOptionDescriptor, { id: "opt1", label: "Option 1", type: "string", default: "default" }));
  it("round-trips boolean option", () => roundTrip(ProviderOptionDescriptor, { id: "opt2", label: "Boolean", type: "boolean", default: false }));
  it("round-trips integer option with range", () => roundTrip(ProviderOptionDescriptor, { id: "opt3", label: "Count", type: "integer", default: 5, min: 1, max: 10 }));
});

describe("ProviderModelDescriptor", () => {
  it("round-trips with options", () => {
    roundTrip(ProviderModelDescriptor, {
      id: "gpt-4",
      label: "GPT-4",
      options: [{ id: "temp", label: "Temperature", type: "number", default: 0.7 }],
    });
  });
});

describe("ModelSelection", () => {
  it("round-trips", () => {
    roundTrip(ModelSelection, {
      provider: "openai",
      model: "gpt-4",
      options: [{ id: "temperature", value: 0.7 }],
    });
  });
});

// ---- Project ----
describe("ProjectSearchEntriesInput", () => {
  it("round-trips minimal", () => roundTrip(ProjectSearchEntriesInput, { cwd: "/tmp", query: "test", limit: 10 }));
  it("round-trips with all fields", () => {
    roundTrip(ProjectSearchEntriesInput, { cwd: "/home/user/project", query: "search term", limit: 50 });
  });
  it("rejects excessive limit", () => roundTripFail(ProjectSearchEntriesInput, { cwd: "/tmp", query: "x", limit: 9999 }));
});

// ---- Git ----
describe("GitAuthState", () => {
  it("round-trips", () => roundTrip(GitAuthState, "authorized"));
  it("round-trips unauthorized", () => roundTrip(GitAuthState, "unauthorized"));
});

// ---- VCS ----
describe("VcsProviderKind", () => {
  it("round-trips git", () => roundTrip(VcsProviderKind, "git"));
});

// ---- Filesystem ----
describe("FilesystemBrowseInput", () => {
  it("round-trips", () => roundTrip(FilesystemBrowseInput, { partialPath: "/home", cwd: "/home/user" }));
  it("rejects empty path", () => roundTripFail(FilesystemBrowseInput, { partialPath: "", cwd: "/tmp" }));
});

// ---- Keybindings ----
describe("KeyBindingAction", () => {
  it("round-trips command action", () => roundTrip(KeyBindingAction, { command: "editor.action.formatDocument" }));
  it("round-trips with args", () => {
    roundTrip(KeyBindingAction, { command: "type", args: { text: "hello" } });
  });
});

// ---- Server Settings ----
describe("ServerSettings", () => {
  it("round-trips", () => roundTrip(ServerSettings, {}));
  it("round-trips with values", () => {
    roundTrip(ServerSettings, {
      traceMinLevel: "Debug",
      traceTimingEnabled: true,
      traceBatchWindowMs: 500,
    });
  });
});

// ---- Provider ----
describe("ProviderCommand", () => {
  it("round-trips list command", () => roundTrip(ProviderCommand, { tag: "ListProviders" }));
});

// ---- Terminal ----
describe("TerminalCommand", () => {
  it("round-trips create", () => roundTrip(TerminalCommand, { tag: "Create", create: { cwd: "/tmp", shell: "bash" } }));
  it("round-trips write", () => roundTrip(TerminalCommand, { tag: "Write", terminalId: "term-1", data: "echo hello\n" }));
  it("round-trips resize", () => roundTrip(TerminalCommand, { tag: "Resize", terminalId: "term-1", cols: 80, rows: 24 }));
});

// ---- Orchestration ----
describe("OrchestrationCommand", () => {
  it("round-trips create project", () => {
    roundTrip(OrchestrationCommand, {
      tag: "ProjectCreate",
      ProjectCreate: { cwd: "/tmp/proj", label: "My Project" },
    });
  });
});

print("Test file ready!")
