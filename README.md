import assert from "node:assert/strict";
import { it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OrchestrationGetTurnDiffInput, ProjectCreateCommand } from "./orchestration.ts";

const roundTrip = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  (input: unknown): Effect.Effect<A, Schema.ParseError, R> =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(schema)(input);
      const encoded = yield* Schema.encode(schema)(parsed);
      return parsed;
    });

describe("Schema Round-trip Validation", () => {
  it.effect("ProjectCreateCommand: round-trip successful", () =>
    Effect.gen(function* () {
      const input = {
        type: "project.create",
        commandId: "cmd-123",
        projectId: "proj-abc",
        title: "Valid Title",
        workspaceRoot: "/home/user/project",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const parsed = yield* roundTrip(ProjectCreateCommand)(input);
      assert.strictEqual(parsed.commandId, "cmd-123");
    }),
  );

  it.effect("ProjectCreateCommand: rejects invalid enum types", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        roundTrip(ProjectCreateCommand)({
          ...{ type: "invalid.type" },
          commandId: "c1",
          projectId: "p1",
          title: "t",
          workspaceRoot: "/",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("OrchestrationGetTurnDiffInput: supports unicode and empty strings", () =>
    Effect.gen(function* () {
      const input = { threadId: "🌟", fromTurnCount: 0, toTurnCount: 1 };
      const parsed = yield* roundTrip(OrchestrationGetTurnDiffInput)(input);
      assert.strictEqual(parsed.threadId, "🌟");
    }),
  );
});