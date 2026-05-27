// @effect-diagnostics-next-line nodeBuiltinImport:off - NodeHttpServer.layer takes `NodeHttp.createServer` as arg
import * as NodeHttp from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as NativePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, test } from "bun:test";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { BadArgument } from "effect/PlatformError";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { cli, cliDetailedVersionString, cliPackageVersion, cliRootVersionString } from "./bin.ts";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState.ts";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { ServerAuthLive } from "./auth/Layers/ServerAuth.ts";

const NodePathLayer = Layer.succeed(
  Path.Path,
  Path.Path.of({
    [Path.TypeId]: Path.TypeId,
    sep: NativePath.sep,
    basename: NativePath.basename,
    dirname: NativePath.dirname,
    extname: NativePath.extname,
    format: NativePath.format,
    fromFileUrl: (url) =>
      Effect.try({
        try: () => fileURLToPath(url),
        catch: (error) =>
          new BadArgument({
            module: "Path",
            method: "fromFileUrl",
            description: String(error),
          }),
      }),
    isAbsolute: NativePath.isAbsolute,
    join: (...paths) => NativePath.join(...paths),
    normalize: NativePath.normalize,
    parse: NativePath.parse,
    relative: NativePath.relative,
    resolve: (...pathSegments) => NativePath.resolve(...pathSegments),
    toFileUrl: (path) => Effect.succeed(pathToFileURL(path)),
    toNamespacedPath: NativePath.toNamespacedPath,
  }),
);

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer, NodePathLayer);

const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: cliPackageVersion })(args);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const testEffect = <A, E>(name: string, makeEffect: () => Effect.Effect<A, E, never>) =>
  test(name, async () => {
    await Effect.runPromise(makeEffect());
  });

const stripAnsi = (value: string) => value.replace(/\u001B\[[0-9;]*m/g, "");

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const makeCliTestServerConfig = (baseDir: string) =>
  Effect.gen(function* () {
    const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "t3-server",
      mode: "web",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    } satisfies ServerConfigShape;
  }).pipe(Effect.provide(NodePathLayer));

const makeProjectPersistenceLayer = (config: ServerConfigShape) =>
  Layer.mergeAll(
    OrchestrationLayerLive.pipe(
      Layer.provideMerge(RepositoryIdentityResolverLive),
      Layer.provideMerge(SqlitePersistenceLayerLive),
    ),
    WorkspacePathsLive,
  ).pipe(
    Layer.provideMerge(NodePathLayer),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(Layer.succeed(ServerConfig, config)),
  );

const readPersistedSnapshot = (baseDir: string) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    return yield* Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      return yield* projectionSnapshotQuery.getSnapshot();
    }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));
  });

const withLiveProjectCliServer = <A, E, R>(baseDir: string, run: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    const routesLayer = Layer.mergeAll(
      orchestrationSnapshotRouteLayer,
      orchestrationDispatchRouteLayer,
    );
    const appLayer = HttpRouter.serve(routesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(
        ServerAuthLive.pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerSecretStoreLive),
        ),
      ),
      Layer.provideMerge(makeProjectPersistenceLayer(config)),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: 0,
        }),
      ),
      Layer.provideMerge(NodePathLayer),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(Layer.succeed(ServerConfig, config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          throw new Error(`Expected TCP address, got ${address}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({
            config,
            port: address.port,
          }),
        });
        return yield* run();
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
    );
  });

describe("bin cli parsing", () => {
  testEffect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  testEffect("accepts canonical --no-<flag> boolean negation", () =>
    runCliWithRuntime(["--no-log-websocket-events", "--version"]),
  );

  testEffect("prints the root version flag output and exits successfully", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--version"]));
      const plainOutput = stripAnsi(String(output));
      expect(plainOutput).toMatch(new RegExp(`\\bt3 v${cliPackageVersion}\\b`));
    }),
  );

  testEffect("prints detailed runtime information for the version subcommand", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["version"]));
      expect(output).toBe(cliDetailedVersionString());
    }),
  );

  testEffect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        throw new Error(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        throw new Error(`Expected InvalidValue, got ${error._tag}`);
      }
      expect(error.option).toBe("log-level");
      expect(error.value).toBe("Debug");
    }),
  );

  testEffect("executes auth pairing subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-auth-pairing-test-"));

      const createdOutput = yield* captureStdout(
        runCli(["auth", "pairing", "create", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const created = JSON.parse(createdOutput.output) as {
        readonly id: string;
        readonly credential: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly id: string;
        readonly credential?: string;
      }>;

      expect(typeof created.id).toBe("string");
      expect(typeof created.credential).toBe("string");
      expect(created.credential.length > 0).toBe(true);
      expect(listed.length).toBe(1);
      expect(listed[0]?.id).toBe(created.id);
      expect("credential" in (listed[0] ?? {})).toBe(false);
    }),
  );

  testEffect("executes auth session subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-auth-session-test-"));

      const issuedOutput = yield* captureStdout(
        runCli(["auth", "session", "issue", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const issued = JSON.parse(issuedOutput.output) as {
        readonly sessionId: string;
        readonly token: string;
        readonly role: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "session", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly sessionId: string;
        readonly token?: string;
        readonly role: string;
      }>;

      expect(typeof issued.sessionId).toBe("string");
      expect(typeof issued.token).toBe("string");
      expect(issued.role).toBe("owner");
      expect(listed.length).toBe(1);
      expect(listed[0]?.sessionId).toBe(issued.sessionId);
      expect(listed[0]?.role).toBe("owner");
      expect("token" in (listed[0] ?? {})).toBe(false);
    }),
  );

  testEffect("rejects invalid ttl values before running auth commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["auth", "pairing", "create", "--ttl", "soon"]).pipe(
        Effect.flip,
      );

      if (!CliError.isCliError(error)) {
        throw new Error(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        throw new Error(`Expected ShowHelp, got ${error._tag}`);
      }
      expect(error.commandPath).toEqual(["t3", "auth", "pairing", "create"]);
      const ttlError = error.errors[0] as CliError.CliError | undefined;
      if (!ttlError || ttlError._tag !== "InvalidValue") {
        throw new Error(`Expected InvalidValue, got ${String(ttlError?._tag)}`);
      }
      expect(ttlError.option).toBe("ttl");
      expect(ttlError.value).toBe("soon");
      expect(ttlError.message.includes("Invalid duration")).toBe(true);
      expect(ttlError.message.includes("5m, 1h, 30d, or 15 minutes")).toBe(true);
    }),
  );

  testEffect("adds, renames, and removes projects offline through the orchestration engine", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-projects-offline-test-"));
      const workspaceRoot = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-projects-workspace-"));

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Alpha",
        "--base-dir",
        baseDir,
      ]);
      const afterAdd = yield* readPersistedSnapshot(baseDir);
      const addedProject = afterAdd.projects.find(
        (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
      );
      expect(addedProject !== undefined).toBe(true);
      expect(addedProject?.title).toBe("Alpha");

      yield* runCliWithRuntime(["project", "rename", workspaceRoot, "Beta", "--base-dir", baseDir]);
      const afterRename = yield* readPersistedSnapshot(baseDir);
      const renamedProject = afterRename.projects.find(
        (project) => project.id === addedProject?.id,
      );
      expect(renamedProject?.title).toBe("Beta");
      expect(renamedProject?.deletedAt).toBe(null);

      yield* runCliWithRuntime([
        "project",
        "remove",
        addedProject?.id ?? "",
        "--base-dir",
        baseDir,
      ]);
      const afterRemove = yield* readPersistedSnapshot(baseDir);
      const removedProject = afterRemove.projects.find(
        (project) => project.id === addedProject?.id,
      );
      expect((removedProject?.deletedAt ?? null) !== null).toBe(true);
    }),
  );

  testEffect("routes project commands through a running server when runtime state is present", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-projects-live-test-"));
      const workspaceRoot = mkdtempSync(NativePath.join(tmpdir(), "t3-cli-projects-live-workspace-"));

      yield* withLiveProjectCliServer(baseDir, () =>
        Effect.gen(function* () {
          yield* runCliWithRuntime([
            "project",
            "add",
            workspaceRoot,
            "--title",
            "Live Project",
            "--base-dir",
            baseDir,
          ]);
          const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
          const readModel = yield* projectionSnapshotQuery.getSnapshot();
          const addedProject = readModel.projects.find(
            (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
          );
          expect(addedProject !== undefined).toBe(true);
          expect(addedProject?.title).toBe("Live Project");
        }),
      );
    }),
  );

  testEffect("rejects dev-url on project commands", () =>
    Effect.gen(function* () {
      const workspaceRoot = mkdtempSync(
        NativePath.join(tmpdir(), "t3-cli-projects-unknown-option-workspace-"),
      );
      const error = yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--dev-url",
        "http://127.0.0.1:5173",
      ]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        throw new Error(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        throw new Error(`Expected ShowHelp, got ${error._tag}`);
      }
      expect(error.commandPath).toEqual(["t3", "project", "add"]);
      const optionError = error.errors[0] as CliError.CliError | undefined;
      if (!optionError || optionError._tag !== "UnrecognizedOption") {
        throw new Error(`Expected UnrecognizedOption, got ${String(optionError?._tag)}`);
      }
      expect(optionError.option).toBe("--dev-url");
    }),
  );
});
