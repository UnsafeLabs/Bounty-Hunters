import { describe, it, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import { InterruptCheckpointService } from "../Services/InterruptCheckpointService.ts";
import { makeInterruptCheckpointService } from "./InterruptCheckpointService.ts";
import type { InterruptedCommand } from "../Services/InterruptCheckpointService.ts";

describe("InterruptCheckpointService", () => {
  const makeTestCommand = (overrides: Partial<InterruptedCommand> = {}): InterruptedCommand => ({
    commandId: "cmd-1",
    aggregateKind: "thread",
    aggregateId: "thread-1",
    partialState: { step: "processing", progress: 50 },
    interruptedAt: new Date().toISOString(),
    reason: "client_disconnect",
    fiberId: 42,
    ...overrides,
  });

  describe("saveInterruptedState", () => {
    it("saves interrupted command state", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        const command = makeTestCommand();
        yield* service.saveInterruptedState(command);
        const retrieved = yield* service.getInterruptedCommand("cmd-1");
        expect(retrieved).not.toBeNull();
        expect(retrieved!.commandId).toBe("cmd-1");
        expect(retrieved!.reason).toBe("client_disconnect");
      });
      await Effect.runPromise(program);
    });

    it("overwrites existing interrupted state for same command", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        yield* service.saveInterruptedState(makeTestCommand({ reason: "client_disconnect" }));
        yield* service.saveInterruptedState(makeTestCommand({ reason: "timeout" }));
        const retrieved = yield* service.getInterruptedCommand("cmd-1");
        expect(retrieved!.reason).toBe("timeout");
      });
      await Effect.runPromise(program);
    });
  });

  describe("getInterruptedCommand", () => {
    it("returns null for non-existent command", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        const result = yield* service.getInterruptedCommand("nonexistent");
        expect(result).toBeNull();
      });
      await Effect.runPromise(program);
    });
  });

  describe("listInterrupted", () => {
    it("lists interrupted commands by aggregateId", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        yield* service.saveInterruptedState(makeTestCommand({ commandId: "cmd-1", aggregateId: "thread-1" }));
        yield* service.saveInterruptedState(makeTestCommand({ commandId: "cmd-2", aggregateId: "thread-1" }));
        yield* service.saveInterruptedState(makeTestCommand({ commandId: "cmd-3", aggregateId: "thread-2" }));

        const list = yield* service.listInterrupted("thread-1");
        expect(list.length).toBe(2);
      });
      await Effect.runPromise(program);
    });

    it("returns empty array when no interrupted commands exist", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        const list = yield* service.listInterrupted("nonexistent");
        expect(list.length).toBe(0);
      });
      await Effect.runPromise(program);
    });
  });

  describe("clearInterrupted", () => {
    it("removes interrupted command from store", async () => {
      const program = Effect.gen(function* () {
        const service = yield* makeInterruptCheckpointService;
        yield* service.saveInterruptedState(makeTestCommand());
        yield* service.clearInterrupted("cmd-1");
        const result = yield* service.getInterruptedCommand("cmd-1");
        expect(result).toBeNull();
      });
      await Effect.runPromise(program);
    });
  });

  describe("interrupt reasons", () => {
    it("supports client_disconnect reason", () => {
      const cmd = makeTestCommand({ reason: "client_disconnect" });
      expect(cmd.reason).toBe("client_disconnect");
    });

    it("supports timeout reason", () => {
      const cmd = makeTestCommand({ reason: "timeout" });
      expect(cmd.reason).toBe("timeout");
    });

    it("supports fiber_interrupt reason", () => {
      const cmd = makeTestCommand({ reason: "fiber_interrupt" });
      expect(cmd.reason).toBe("fiber_interrupt");
    });
  });
});
