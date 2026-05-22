import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { ServerAuthPolicy, ServerAuthBootstrapMethod, ServerAuthSessionMethod, AuthSessionRole, ServerAuthDescriptor } from "./auth.ts";
import { EditorLaunchStyle, EditorId } from "./editor.ts";
import { ExecutionEnvironmentPlatformOs, ExecutionEnvironmentPlatformArch, ExecutionEnvironmentPlatform, ExecutionEnvironmentCapabilities } from "./environment.ts";
import { ProviderOptionDescriptorType, ProviderOptionChoice, ProviderOptionDescriptor } from "./model.ts";
import { VcsDriverKind, VcsFreshnessSource, VcsFreshness } from "./vcs.ts";
import { ProjectSearchEntriesInput, ProjectEntry } from "./project.ts";
import { AdvertisedEndpointProviderKind, AdvertisedEndpointReachability, AdvertisedEndpointHostedHttpsCompatibility, AdvertisedEndpointStatus, AdvertisedEndpointSource } from "./remoteAccess.ts";
import { DesktopUpdateStatusSchema, DesktopRuntimeArchSchema, DesktopThemeSchema, DesktopUpdateChannelSchema, DesktopServerExposureModeSchema, DesktopSshHostSourceSchema } from "./ipc.ts";
import { FilesystemBrowseInput, FilesystemBrowseEntry, FilesystemBrowseResult } from "./filesystem.ts";
import { SourceControlProviderKind, SourceControlCloneProtocol, SourceControlRepositoryVisibility, ChangeRequestState, SourceControlDiscoveryStatus } from "./sourceControl.ts";
import { DesktopBackendBootstrap } from "./desktopBootstrap.ts";

const rt = <A>(schema: Schema.Schema<A, any>, input: A) => {
  const encoded = Schema.encodeSync(schema)(input);
  expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(input);
};

const decodes = <A>(schema: Schema.Schema<A, any>, input: any): A => Schema.decodeUnknownSync(schema)(input);

const fails = <A>(schema: Schema.Schema<A, any>, input: any) => {
  expect(() => Schema.decodeUnknownSync(schema)(input)).toThrow();
};

describe("auth", () => {
  it("ServerAuthPolicy round-trips all variants", () => {
    for (const v of ["optional", "required", "disabled"] as const) {
      rt(ServerAuthPolicy, v);
    }
  });
  it("ServerAuthPolicy rejects invalid", () => fails(ServerAuthPolicy, "unknown"));

  it("ServerAuthBootstrapMethod round-trips", () => {
    rt(ServerAuthBootstrapMethod, "desktop-bootstrap");
    rt(ServerAuthBootstrapMethod, "one-time-token");
  });

  it("AuthSessionRole round-trips", () => {
    rt(AuthSessionRole, "owner");
    rt(AuthSessionRole, "client");
  });

  it("ServerAuthDescriptor round-trips minimum", () => {
    const d = decodes(ServerAuthDescriptor, {
      policy: "required",
      allowedBootstrapMethods: ["desktop-bootstrap"],
      allowedSessionMethods: ["desktop-bootstrap"],
      signingKey: "key123",
    });
    expect(d.policy).toBe("required");
  });
});

describe("editor", () => {
  it("EditorLaunchStyle round-trips all", () => {
    for (const v of ["direct-path", "goto", "line-column"] as const) rt(EditorLaunchStyle, v);
  });
  it("EditorId round-trips a few", () => {
    rt(EditorId, "vscode");
    rt(EditorId, "cursor");
  });
  it("EditorId rejects garbage", () => fails(EditorId, "not-an-editor"));
});

describe("environment", () => {
  it("ExecutionEnvironmentPlatformOs round-trips", () => {
    rt(ExecutionEnvironmentPlatformOs, "win32");
    rt(ExecutionEnvironmentPlatformOs, "darwin");
    rt(ExecutionEnvironmentPlatformOs, "linux");
  });
  it("ExecutionEnvironmentPlatformArch round-trips", () => {
    rt(ExecutionEnvironmentPlatformArch, "arm64");
    rt(ExecutionEnvironmentPlatformArch, "x64");
    rt(ExecutionEnvironmentPlatformArch, "other");
  });
  it("ExecutionEnvironmentPlatform round-trips", () => {
    const p = decodes(ExecutionEnvironmentPlatform, { os: "linux", arch: "x64" });
    expect(p.os).toBe("linux");
  });
  it("ExecutionEnvironmentCapabilities round-trips with defaults", () => {
    const c = decodes(ExecutionEnvironmentCapabilities, {});
    expect(c.repositoryIdentity).toBe(false);
  });
});

describe("model", () => {
  it("ProviderOptionDescriptorType round-trips", () => {
    rt(ProviderOptionDescriptorType, "select");
    rt(ProviderOptionDescriptorType, "boolean");
  });
  it("ProviderOptionChoice round-trips", () => {
    rt(ProviderOptionChoice, { label: "Opt A", value: "a" });
  });
  it("ProviderOptionDescriptor round-trips select type", () => {
    const d = decodes(ProviderOptionDescriptor, {
      type: "select",
      key: "model",
      label: "Model",
      options: [{ label: "GPT-4", value: "gpt4" }],
      defaultValue: "gpt4",
    });
    expect(d.key).toBe("model");
  });
});

describe("vcs", () => {
  it("VcsDriverKind round-trips", () => {
    rt(VcsDriverKind, "git");
    rt(VcsDriverKind, "jj");
    rt(VcsDriverKind, "unknown");
  });
  it("VcsFreshnessSource round-trips", () => {
    rt(VcsFreshnessSource, "poll");
    rt(VcsFreshnessSource, "webhook");
    rt(VcsFreshnessSource, "manual");
  });
  it("VcsFreshness round-trips", () => {
    const f = decodes(VcsFreshness, {
      kind: "fresh",
      source: "poll",
      observedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    });
    expect(f.kind).toBe("fresh");
  });
});

describe("project", () => {
  it("ProjectEntry round-trips file", () => {
    const e = decodes(ProjectEntry, { kind: "file", path: "src/main.ts" });
    expect(e.path).toBe("src/main.ts");
  });
  it("ProjectSearchEntriesInput rejects long query", () => {
    fails(ProjectSearchEntriesInput, { query: "a".repeat(300), limit: 10 });
  });
});

describe("remoteAccess", () => {
  it("AdvertisedEndpointProviderKind round-trips", () => {
    rt(AdvertisedEndpointProviderKind, "tailscale");
    rt(AdvertisedEndpointProviderKind, "ngrok");
  });
  it("AdvertisedEndpointStatus round-trips", () => {
    rt(AdvertisedEndpointStatus, "available");
    rt(AdvertisedEndpointStatus, "unavailable");
    rt(AdvertisedEndpointStatus, "unknown");
  });
  it("AdvertisedEndpointSource rejects unknown", () => fails(AdvertisedEndpointSource, "bogus"));
});

describe("ipc", () => {
  it("DesktopRuntimeArchSchema round-trips", () => {
    rt(DesktopRuntimeArchSchema, "arm64");
    rt(DesktopRuntimeArchSchema, "x64");
  });
  it("DesktopThemeSchema round-trips", () => {
    rt(DesktopThemeSchema, "light");
    rt(DesktopThemeSchema, "dark");
  });
  it("DesktopUpdateChannelSchema round-trips", () => rt(DesktopUpdateChannelSchema, "latest"));
  it("DesktopSshHostSourceSchema round-trips", () => rt(DesktopSshHostSourceSchema, "ssh-config"));
  it("DesktopServerExposureModeSchema round-trips", () => {
    rt(DesktopServerExposureModeSchema, "local");
    rt(DesktopServerExposureModeSchema, "tailscale");
  });
});

describe("filesystem", () => {
  it("FilesystemBrowseInput round-trips", () => {
    const f = decodes(FilesystemBrowseInput, { path: "/home/user" });
    expect(f.path).toBe("/home/user");
  });
  it("FilesystemBrowseEntry round-trips", () => {
    const e = decodes(FilesystemBrowseEntry, { name: "file.txt", kind: "file" });
    expect(e.name).toBe("file.txt");
    expect(e.kind).toBe("file");
  });
});

describe("sourceControl", () => {
  it("SourceControlProviderKind round-trips", () => rt(SourceControlProviderKind, "github"));
  it("ChangeRequestState round-trips all", () => {
    for (const v of ["open", "closed", "merged"] as const) rt(ChangeRequestState, v);
  });
  it("SourceControlCloneProtocol round-trips", () => rt(SourceControlCloneProtocol, "ssh"));
  it("SourceControlRepositoryVisibility round-trips", () => rt(SourceControlRepositoryVisibility, "private"));
  it("SourceControlDiscoveryStatus round-trips", () => rt(SourceControlDiscoveryStatus, "available"));
});

describe("desktopBootstrap", () => {
  it("DesktopBackendBootstrap round-trips", () => {
    const b = decodes(DesktopBackendBootstrap, { backendOrigin: "http://localhost:3000" });
    expect(b.backendOrigin).toBe("http://localhost:3000");
  });
});
