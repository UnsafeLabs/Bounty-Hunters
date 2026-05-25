```diff
--- a/t3code/packages/contracts/src/orchestration.test.ts
+++ b/t3code/packages/contracts/src/orchestration.test.ts
@@ -1,6 +1,7 @@
 import assert from "node:assert/strict";
 import { it } from "@effect/vitest";
 import * as Effect from "effect/Effect";
+import * as Either from "effect/Either";
 import * as Schema from "effect/Schema";
 
 import {
@@ -14,6 +15,7 @@
   OrchestrationLatestTurn,
   ProjectCreatedPayload,
   ProjectMetaUpdatedPayload,
+  OrchestrationMode,
   OrchestrationProposedPlan,
   OrchestrationSession,
   ProjectCreateCommand,
@@ -22,6 +24,7 @@
   ThreadTurnDiff,
   ThreadTurnStartRequestedPayload,
 } from "./orchestration.ts";
+import { ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";
 import { ProviderInstanceId } from "./providerInstance.ts";
 
 const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
@@ -46,6 +49,8 @@
 const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
 const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
 
+const roundTrip = <A, I>(schema: Schema.Schema<A, I, never>) => (input: unknown) => Effect.gen(function* () {
+  const decoded = yield* Schema.decodeUnknownEffect(schema)(input);
+  const encoded = yield* Schema.encodeEffect(schema)(decoded);
+  return encoded;
+});
+
 it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
   Effect.gen(function* () {
     const parsed = yield* decodeTurnDiffInput({
@@ -96,3 +101,1030 @@
     assert.strictEqual(result._tag, "Failure");
   }),
 );
+
+// Round-trip tests for all exported schema types
+
+it.effect("OrchestrationGetTurnDiffInput round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", fromTurnCount: 1, toTurnCount: 2 };
+    const result = yield* roundTrip(OrchestrationGetTurnDiffInput)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("OrchestrationGetFullThreadDiffInput round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", toTurnCount: 2 };
+    const result = yield* roundTrip(OrchestrationGetFullThreadDiffInput)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ThreadTurnDiff round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", fromTurnCount: 1, toTurnCount: 2, diff: "patch" };
+    const result = yield* roundTrip(ThreadTurnDiff)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ProjectCreateCommand round-trip", () =>
+  Effect.gen(function* () {
+    const input = { name: "My Project", description: "A test project" };
+    const result = yield* roundTrip(ProjectCreateCommand)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ProjectCreatedPayload round-trip", () =>
+  Effect.gen(function* () {
+    const input = { projectId: "proj-1", name: "My Project", createdAt: "2024-01-01T00:00:00Z" };
+    const result = yield* roundTrip(ProjectCreatedPayload)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ProjectMetaUpdatedPayload round-trip", () =>
+  Effect.gen(function* () {
+    const input = { projectId: "proj-1", name: "Updated Name", updatedAt: "2024-01-01T00:00:00Z" };
+    const result = yield* roundTrip(ProjectMetaUpdatedPayload)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ThreadTurnStartCommand round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", providerInstanceId: "prov-1" };
+    const result = yield* roundTrip(ThreadTurnStartCommand)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ThreadTurnStartRequestedPayload round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", turnId: "turn-1", requestedAt: "2024-01-01T00:00:00Z" };
+    const result = yield* roundTrip(ThreadTurnStartRequestedPayload)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("OrchestrationLatestTurn round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", turnCount: 5, status: "completed" };
+    const result = yield* roundTrip(OrchestrationLatestTurn)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("OrchestrationProposedPlan round-trip", () =>
+  Effect.gen(function* () {
+    const input = { planId: "plan-1", threadId: "thread-1", steps: [] };
+    const result = yield* roundTrip(OrchestrationProposedPlan)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("OrchestrationSession round-trip", () =>
+  Effect.gen(function* () {
+    const input = { sessionId: "sess-1", projectId: "proj-1", mode: "interactive" };
+    const result = yield* roundTrip(OrchestrationSession)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("ThreadCreatedPayload round-trip", () =>
+  Effect.gen(function* () {
+    const input = { threadId: "thread-1", projectId: "proj-1", createdAt: "2024-01-01T00:00:00Z" };
+    const result = yield* roundTrip(ThreadCreatedPayload)(input);
+    assert.deepStrictEqual(result, input);
+  }),
+);
+
+it.effect("OrchestrationCommand round-trip", () =>
+  Effect.gen(function* () {
+    const input = { type: "createProject", payload: { name: "Test", description: "desc" } };
+    const result = yield* roundTrip(Orc