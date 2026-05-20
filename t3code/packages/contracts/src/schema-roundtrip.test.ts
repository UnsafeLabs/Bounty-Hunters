import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  ThreadId,
  ProjectId,
  TrimmedNonEmptyString,
  EventId,
  TurnId,
} from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import {
  ProviderSession,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
} from "./provider.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ProviderOptionSelection, ProviderOptionSelections } from "./model.ts";
import { ModelSelection } from "./orchestration.ts";
import {
  ProviderInstanceConfig,
} from "./providerInstance.ts";
import {
  ServerSettings,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  TimestampFormat,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
} from "./settings.ts";

describe("base schema types round-trip", () => {
  it("TrimmedNonEmptyString trims and preserves", () => {
    const decode = Schema.decodeUnknownSync(TrimmedNonEmptyString);
    const encode = Schema.encodeSync(TrimmedNonEmptyString);
    expect(encode(decode("  hello  "))).toBe("hello");
    expect(encode(decode("hello"))).toBe("hello");
  });

  it("ThreadId branded string round-trips", () => {
    const decode = Schema.decodeUnknownSync(ThreadId);
    const encode = Schema.encodeSync(ThreadId);
    const value = "thread-1";
    expect(encode(decode(value))).toBe(value);
  });

  it("ProjectId branded string round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProjectId);
    const encode = Schema.encodeSync(ProjectId);
    const value = "project-1";
    expect(encode(decode(value))).toBe(value);
  });

  it("EventId branded string round-trips", () => {
    const decode = Schema.decodeUnknownSync(EventId);
    const encode = Schema.encodeSync(EventId);
    const value = "event-1";
    expect(encode(decode(value))).toBe(value);
  });

  it("TurnId branded string round-trips", () => {
    const decode = Schema.decodeUnknownSync(TurnId);
    const encode = Schema.encodeSync(TurnId);
    const value = "turn-1";
    expect(encode(decode(value))).toBe(value);
  });

  it("ProviderInstanceId branded string round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProviderInstanceId);
    const encode = Schema.encodeSync(ProviderInstanceId);
    const value = "codex_personal";
    expect(encode(decode(value))).toBe(value);
  });
});

describe("environment schema types round-trip", () => {
  it("ExecutionEnvironmentDescriptor round-trips", () => {
    const decode = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
    const encode = Schema.encodeSync(ExecutionEnvironmentDescriptor);
    const input = {
      environmentId: "env-1",
      label: "Local",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "1.0.0",
      capabilities: { repositoryIdentity: true },
    };
    const decoded = decode(input);
    expect(encode(decoded)).toEqual(input);
  });
});

describe("provider schema types round-trip", () => {
  it("ProviderSessionStartInput round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProviderSessionStartInput);
    const encode = Schema.encodeSync(ProviderSessionStartInput);
    const input = {
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
    };
    const decoded = decode(input);
    expect(encode(decoded)).toEqual(input);
  });

  it("ProviderSession round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProviderSession);
    const encode = Schema.encodeSync(ProviderSession);
    const input = {
      provider: "codex",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const decoded = decode(input);
    expect(encode(decoded)).toEqual(input);
  });

  it("ProviderSendTurnInput round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProviderSendTurnInput);
    const encode = Schema.encodeSync(ProviderSendTurnInput);
    const input = {
      threadId: "thread-1",
      input: "hello",
    };
    const decoded = decode(input);
    expect(encode(decoded)).toEqual(input);
  });

  it("ModelSelection with instanceId round-trips", () => {
    const decode = Schema.decodeUnknownSync(ModelSelection);
    const encode = Schema.encodeSync(ModelSelection);
    const input = {
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    };
    const decoded = decode(input);
    expect(encode(decoded)).toEqual(input);
  });
});

describe("settings schema types round-trip", () => {
  it("TimestampFormat literals round-trip", () => {
    const decode = Schema.decodeUnknownSync(TimestampFormat);
    const encode = Schema.encodeSync(TimestampFormat);
    for (const value of ["locale", "12-hour", "24-hour"] as const) {
      expect(encode(decode(value))).toBe(value);
    }
  });

  it("SidebarProjectSortOrder literals round-trip", () => {
    const decode = Schema.decodeUnknownSync(SidebarProjectSortOrder);
    const encode = Schema.encodeSync(SidebarProjectSortOrder);
    for (const value of ["updated_at", "created_at", "manual"] as const) {
      expect(encode(decode(value))).toBe(value);
    }
  });

  it("SidebarThreadSortOrder literals round-trip", () => {
    const decode = Schema.decodeUnknownSync(SidebarThreadSortOrder);
    const encode = Schema.encodeSync(SidebarThreadSortOrder);
    for (const value of ["updated_at", "created_at"] as const) {
      expect(encode(decode(value))).toBe(value);
    }
  });

  it("DEFAULT_CLIENT_SETTINGS round-trips through encode", () => {
    const encode = Schema.encodeSync(ClientSettingsSchema);
    const decode = Schema.decodeSync(ClientSettingsSchema);
    const encoded = encode(DEFAULT_CLIENT_SETTINGS);
    const decoded = decode(encoded);
    expect(decoded).toEqual(DEFAULT_CLIENT_SETTINGS);
  });

  it("DEFAULT_SERVER_SETTINGS round-trips through encode", () => {
    const encode = Schema.encodeSync(ServerSettings);
    const decode = Schema.decodeSync(ServerSettings);
    const encoded = encode(DEFAULT_SERVER_SETTINGS);
    const decoded = decode(encoded);
    // providerInstances is an empty record on default
    expect(decoded.providerInstances).toEqual({});
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("ServerSettings with custom provider config round-trips", () => {
    const decode = Schema.decodeUnknownSync(ServerSettings);
    const encode = Schema.encodeSync(ServerSettings);
    const input = {
      providers: {
        codex: {
          enabled: true,
          binaryPath: "/usr/local/bin/codex",
          homePath: "~/.codex",
          shadowHomePath: "",
          customModels: ["gpt-5-codex"],
        },
        claudeAgent: {
          enabled: true,
          binaryPath: "claude",
          homePath: "~",
          customModels: [],
          launchArgs: "",
        },
        cursor: {
          enabled: false,
          binaryPath: "agent",
          apiEndpoint: "",
          customModels: [],
        },
        opencode: {
          enabled: true,
          binaryPath: "opencode",
          serverUrl: "",
          serverPassword: "",
          customModels: [],
        },
      },
      providerInstances: {},
      observability: {
        otlpTracesUrl: "",
        otlpMetricsUrl: "",
      },
    };
    const decoded = decode(input);
    const encoded = encode(decoded);
    expect(encoded.providers.codex.binaryPath).toBe("/usr/local/bin/codex");
    expect(encoded.providers.codex.customModels).toEqual(["gpt-5-codex"]);
  });

  it("ClientSettings with favorites round-trips", () => {
    const decode = Schema.decodeUnknownSync(ClientSettingsSchema);
    const encode = Schema.encodeSync(ClientSettingsSchema);
    const input = {
      favorites: [
        { provider: "codex", model: "gpt-5-codex" },
        { provider: "claudeAgent", model: "claude-sonnet-4-6" },
      ],
    };
    const decoded = decode(input);
    const encoded = encode(decoded);
    expect(encoded.favorites).toEqual([
      { provider: "codex", model: "gpt-5-codex" },
      { provider: "claudeAgent", model: "claude-sonnet-4-6" },
    ]);
  });
});

describe("ProviderOptionSelection round-trip", () => {
  it("string selections round-trip", () => {
    const decode = Schema.decodeUnknownSync(ProviderOptionSelection);
    const encode = Schema.encodeSync(ProviderOptionSelection);
    const input = { id: "reasoningEffort", value: "high" };
    expect(encode(decode(input))).toEqual(input);
  });

  it("boolean selections round-trip", () => {
    const decode = Schema.decodeUnknownSync(ProviderOptionSelection);
    const encode = Schema.encodeSync(ProviderOptionSelection);
    const input = { id: "fastMode", value: true };
    expect(encode(decode(input))).toEqual(input);
  });

  it("ProviderOptionSelections round-trips", () => {
    const decode = Schema.decodeUnknownSync(ProviderOptionSelections);
    const encode = Schema.encodeSync(ProviderOptionSelections);
    const input = [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ];
    expect(encode(decode(input))).toEqual(input);
  });
});
