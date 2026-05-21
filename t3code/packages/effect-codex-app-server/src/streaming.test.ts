import * as Chunk from "effect/Chunk";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as streaming from "./streaming.ts";

const describe = {
  streaming: {
    selectDiffChunk: {
      "should extract diff chunks from turn/diff/updated notification": () =>
        Effect.gen(function* () {
          const notification = {
            jsonrpc: "2.0",
            method: "turn/diff/updated",
            params: {
              diffs: [
                { text: "Hello" },
                { text: " world" },
              ],
            },
          };

          const result = streaming.selectDiffChunk(notification as any);
          return Chunk.make(result?.length === 2 && result[0] === "Hello" && result[1] === " world");
        }),

      "should return undefined for non-diff notifications": () =>
        Effect.gen(function* () {
          const notification = {
            jsonrpc: "2.0",
            method: "other/method",
            params: {},
          };

          const result = streaming.selectDiffChunk(notification as any);
          return Chunk.make(result === undefined);
        }),
    },

    selectMessageDelta: {
      "should extract delta from agentMessage/delta notification": () =>
        Effect.gen(function* () {
          const notification = {
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: {
              delta: "some text",
            },
          };

          const result = streaming.selectMessageDelta(notification as any);
          return Chunk.make(result === "some text");
        }),

      "should return undefined for non-delta notifications": () =>
        Effect.gen(function* () {
          const notification = {
            jsonrpc: "2.0",
            method: "other/method",
            params: {},
          };

          const result = streaming.selectMessageDelta(notification as any);
          return Chunk.make(result === undefined);
        }),
    },
  },
};

export { describe };

// Simple test runner
export const runTests = () =>
  Effect.gen(function* () {
    // Test selectDiffChunk
    const test1Result = yield* describe.streaming.selectDiffChunk["should extract diff chunks from turn/diff/updated notification"]();
    if (!Chunk.unsafeHead(test1Result)) {
      yield* Effect.fail(new Error("selectDiffChunk test 1 failed"));
    }

    const test2Result = yield* describe.streaming.selectDiffChunk["should return undefined for non-diff notifications"]();
    if (!Chunk.unsafeHead(test2Result)) {
      yield* Effect.fail(new Error("selectDiffChunk test 2 failed"));
    }

    // Test selectMessageDelta
    const test3Result = yield* describe.streaming.selectMessageDelta["should extract delta from agentMessage/delta notification"]();
    if (!Chunk.unsafeHead(test3Result)) {
      yield* Effect.fail(new Error("selectMessageDelta test 1 failed"));
    }

    const test4Result = yield* describe.streaming.selectMessageDelta["should return undefined for non-delta notifications"]();
    if (!Chunk.unsafeHead(test4Result)) {
      yield* Effect.fail(new Error("selectMessageDelta test 2 failed"));
    }

    yield* Effect.log("All streaming tests passed!");
  });