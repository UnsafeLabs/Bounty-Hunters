import {
  ClientOrchestrationCommand,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as zlib from "node:zlib";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { cast, pipe } from "effect/Function";
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { ServerConfig } from "../config.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const MIN_COMPRESSION_SIZE = 1024;

const UNCOMPRESSIBLE_CONTENT_TYPES = new Set([
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/x-zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-rar",
  "application/pdf",
  "application/ogg",
]);

const isUncompressibleContentType = (contentType: string): boolean =>
  UNCOMPRESSIBLE_CONTENT_TYPES.has(contentType) ||
  UNCOMPRESSIBLE_CONTENT_TYPES.has(contentType.split(";")[0].trim()) ||
  UNCOMPRESSIBLE_CONTENT_TYPES.some((type) => contentType.startsWith(type));

const preferredEncoding = (acceptEncoding: string | undefined): "br" | "gzip" | undefined => {
  if (!acceptEncoding) return undefined;
  const encodings = acceptEncoding.split(",").map((e) => e.trim().toLowerCase());
  if (encodings.includes("br")) return "br";
  if (encodings.includes("gzip")) return "gzip";
  return undefined;
};

const compressSync = (
  data: Uint8Array,
  encoding: "br" | "gzip",
  level: number,
): Uint8Array => {
  if (encoding === "br") {
    return zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC, [zlib.constants.BROTLI_PARAM_QUALITY]: level } });
  }
  return zlib.gzipSync(data, { level });
};

const decompressSync = (data: Buffer, encoding: "br" | "gzip"): Buffer => {
  if (encoding === "br") {
    return zlib.brotliDecompressSync(data);
  }
  return zlib.gunzipSync(data);
};

const decompressRequestBody = (
  body: Uint8Array,
  contentEncoding: string | undefined,
): Buffer => {
  if (!contentEncoding) return Buffer.from(body);
  const encoding = preferredEncoding(contentEncoding);
  if (!encoding) return Buffer.from(body);
  try {
    return decompressSync(Buffer.from(body), encoding);
  } catch {
    return Buffer.from(body);
  }
};

const compressResponseBody = (
  body: Uint8Array,
  contentType: string,
  acceptEncoding: string | undefined,
  compressionLevel: number,
): { body: Uint8Array; contentEncoding: "br" | "gzip" } | undefined => {
  if (body.length < MIN_COMPRESSION_SIZE) return undefined;
  if (isUncompressibleContentType(contentType)) return undefined;
  const encoding = preferredEncoding(acceptEncoding);
  if (!encoding) return undefined;
  try {
    const compressed = compressSync(body, encoding, compressionLevel);
    if (compressed.length >= body.length) return undefined;
    return { body: compressed, contentEncoding: encoding };
  } catch {
    return undefined;
  }
};

const compressedJsonResponse = (
  data: unknown,
  acceptEncoding: string | undefined,
  compressionLevel: number,
  status: number,
): HttpServerResponse.HttpServerResponse => {
  const body = new TextEncoder().encode(JSON.stringify(data));
  const compressed = compressResponseBody(body, "application/json", acceptEncoding, compressionLevel);
  if (compressed) {
    return HttpServerResponse.uint8Array(compressed.body, {
      status,
      contentType: "application/json",
      headers: { "Content-Encoding": compressed.contentEncoding },
    });
  }
  return HttpServerResponse.uint8Array(body, {
    status,
    contentType: "application/json",
  });
};

const respondToOrchestrationHttpError = (
  error: OrchestrationDispatchCommandError | OrchestrationGetSnapshotError,
) =>
  Effect.gen(function* () {
    if (error._tag === "OrchestrationGetSnapshotError") {
      yield* Effect.logError("orchestration http route failed", {
        message: error.message,
        cause: error.cause,
      });
      return HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 500 });
    }

    return HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 });
  });

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new OrchestrationDispatchCommandError({
      message: "Only owner sessions can manage projects.",
    });
  }
  return session;
});

export const orchestrationSnapshotRouteLayer = HttpRouter.add(
  "GET",
  "/api/orchestration/snapshot",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const config = yield* ServerConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const acceptEncoding = request.headers["accept-encoding"];
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const snapshot = yield* projectionSnapshotQuery.getSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationGetSnapshotError({
            message: "Failed to load orchestration snapshot.",
            cause,
          }),
      ),
    );
    return compressedJsonResponse(snapshot, acceptEncoding, config.compressionLevel, 200);
  }).pipe(
    Effect.catchTag("OrchestrationDispatchCommandError", respondToOrchestrationHttpError),
    Effect.catchTag("OrchestrationGetSnapshotError", respondToOrchestrationHttpError),
  ),
);

export const orchestrationDispatchRouteLayer = HttpRouter.add(
  "POST",
  "/api/orchestration/dispatch",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const config = yield* ServerConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const acceptEncoding = request.headers["accept-encoding"];
    const contentEncoding = request.headers["content-encoding"];
    const orchestrationEngine = yield* OrchestrationEngineService;

    // Decompress request body if encoded
    const rawBody = cast<Uint8Array, Uint8Array>(yield* request.arrayBuffer);
    const decompressedBody = decompressRequestBody(rawBody, contentEncoding);
    const command = cast<unknown, ClientOrchestrationCommand>(JSON.parse(decompressedBody.toString()));
    // Validate with schema
    const ValidatedCommand = yield* Effect.sync(() => {
      const decodeSchema = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
      return decodeSchema(command);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: "Invalid orchestration command payload.",
            cause,
          }),
      ),
    );
    const normalizedCommand = yield* normalizeDispatchCommand(ValidatedCommand);
    const result = yield* orchestrationEngine.dispatch(normalizedCommand).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: "Failed to dispatch orchestration command.",
            cause,
          }),
      ),
    );
    return compressedJsonResponse(result, acceptEncoding, config.compressionLevel, 200);
  }).pipe(Effect.catchTag("OrchestrationDispatchCommandError", respondToOrchestrationHttpError)),
);
