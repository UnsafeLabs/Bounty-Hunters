import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { expect } from "vitest";

import { CodexSettings, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  decodeCodexStream,
  runCodexStream,
  type CodexStreamingOptions,
} from "./CodexTextGeneration.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);
import * as Schema from "effect/Schema";

const TestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-codex-stream-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

import { ServerConfig } from "../config.ts";

function makeFakeCodexStreamBinary(
  dir: string,
  input: {
    lines: ReadonlyArray<string>;
    exitCode?: number;
    delayPerLineMs?: number;
  },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = path.join(dir, "bin");
    const codexPath = path.join(binDir, "codex");
    yield* fs.makeDirectory(binDir, { recursive: true });

    const lines = input.lines.map((l) => `echo ${JSON.stringify(l)}`).join("\n");
    const delay = input.delayPerLineMs ?? 0;

    yield* fs.writeFileString(
      codexPath,
      [
        "#!/bin/sh",
        "cat /dev/stdin > /dev/null",
        ...(delay > 0
          ? input.lines.map((l) => `sleep ${(delay / 1000).toFixed(3)} && echo ${JSON.stringify(l)}`)
          : [lines]),
        `exit ${input.exitCode ?? 0}`,
        "",
      ].join("\n"),
    );
    yield* fs.chmod(codexPath, 0o755);
    return codexPath;
  });
}

function withFakeCodexStream<A, E, R>(
  input: {
    lines: ReadonlyArray<string>;
    exitCode?: number;
    delayPerLineMs?: number;
  },
  effectFn: (
    runStream: (prompt: string, opts?: Partial<CodexStreamingOptions>) => Effect.Effect<
      ReadonlyArray<string>,
      TextGenerationError
    >,
  ) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-codex-stream-" });
    const codexPath = yield* makeFakeCodexStreamBinary(tempDir, input);
    const config = decodeCodexSettings({ binaryPath: codexPath });
    const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4-mini");

    const runStream = (prompt: string, opts?: Partial<CodexStreamingOptions>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const raw = yield* runCodexStream(config, prompt, {
            modelSelection,
            ...opts,
          });
          const decoded = decodeCodexStream(raw);
          return yield* decoded.pipe(Stream.runCollect).pipe(
            Effect.map((chunks) => Array.from(chunks)),
          );
        }),
      );

    return yield* effectFn(runStream);
  }).pipe(Effect.scoped);
}

it.layer(TestLayer)("CodexTextGeneration streaming", (it) => {
  it.effect("yields streamed output chunks in order", () =>
    withFakeCodexStream(
      { lines: ["chunk1", "chunk2", "chunk3"] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("test prompt");
          expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
        }),
    ),
  );

  it.effect("yields single chunk for single line output", () =>
    withFakeCodexStream(
      { lines: ["hello world"] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          expect(chunks).toEqual(["hello world"]);
        }),
    ),
  );

  it.effect("yields empty array for empty output", () =>
    withFakeCodexStream(
      { lines: [] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          expect(chunks).toEqual([]);
        }),
    ),
  );

  it.effect("decoded stream matches runCollect result", () =>
    withFakeCodexStream(
      { lines: ["line1", "line2", "line3"] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          expect(chunks.join("")).toBe("line1line2line3");
        }),
    ),
  );

  it.effect("handles slow producer with backpressure", () =>
    withFakeCodexStream(
      { lines: ["a", "b", "c"], delayPerLineMs: 50 },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          expect(chunks).toEqual(["a", "b", "c"]);
        }),
    ),
  );

  it.effect("abort signal terminates stream early", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-codex-abort-" });
      const codexPath = yield* makeFakeCodexStreamBinary(tempDir, {
        lines: ["keep", "going", "forever"],
        delayPerLineMs: 500,
      });
      const config = decodeCodexSettings({ binaryPath: codexPath });
      const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4-mini");
      const abortController = new AbortController();

      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          const raw = yield* runCodexStream(config, "prompt", {
            modelSelection,
            abortSignal: abortController.signal,
          });
          return yield* decodeCodexStream(raw).pipe(Stream.runCollect);
        }),
      ).pipe(Effect.fork);

      yield* Effect.sleep(Duration.millis(100));
      abortController.abort();

      const result = yield* fiber.pipe(Effect.await);
      expect(Array.from(result).length).toBeLessThan(3);
    }),
  );

  it.effect("non-streaming API continues to work alongside streaming", () =>
    withFakeCodexStream(
      { lines: ["streamed"] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          expect(chunks).toEqual(["streamed"]);

          const collected = yield* Effect.scoped(
            Effect.gen(function* () {
              const fs2 = yield* FileSystem.FileSystem;
              const tempDir2 = yield* fs2.makeTempDirectoryScoped({ prefix: "t3code-nonstream-" });
              const codexPath2 = yield* makeFakeCodexStreamBinary(tempDir2, {
                lines: ["non-streamed"],
              });
              const config2 = decodeCodexSettings({ binaryPath: codexPath2 });
              const raw = yield* runCodexStream(config2, "prompt", {
                modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4-mini"),
              });
              return yield* decodeCodexStream(raw).pipe(Stream.runCollect);
            }),
          );
          expect(Array.from(collected)).toEqual(["non-streamed"]);
        }),
    ),
  );

  it.effect("fails with TextGenerationError on non-zero exit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-codex-fail-" });
      const codexPath = yield* makeFakeCodexStreamBinary(tempDir, {
        lines: ["partial"],
        exitCode: 1,
      });
      const config = decodeCodexSettings({ binaryPath: codexPath });

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4-mini");
          const raw = yield* runCodexStream(config, "prompt", { modelSelection });
          return yield* decodeCodexStream(raw).pipe(Stream.runCollect);
        }),
      ).pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.cause).toBeInstanceOf(TextGenerationError);
      }
    }),
  );

  it.effect("stream has no duplicate chunks", () =>
    withFakeCodexStream(
      { lines: ["a", "b", "a", "c"] },
      (runStream) =>
        Effect.gen(function* () {
          const chunks = yield* runStream("prompt");
          const seen = new Set<string>();
          for (const chunk of chunks) {
            expect(seen.has(chunk)).toBe(false);
            seen.add(chunk);
          }
        }),
    ),
  );
});
