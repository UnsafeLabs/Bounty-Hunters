import { describe, expect, it } from "vitest";
import {
  CommandId,
  type OrchestrationCommand,
  type ScheduledCommand,
} from "@t3tools/contracts";

import {
  parseRepeatIntervalMs,
  SchedulerService,
  type ScheduledCommandRecord,
  type SchedulerStore,
} from "./SchedulerService.ts";

const command = (commandId: string): OrchestrationCommand =>
  ({
    type: "thread.session.stop",
    commandId: CommandId.make(commandId),
    threadId: "thread-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as OrchestrationCommand;

class MemorySchedulerStore implements SchedulerStore {
  readonly records = new Map<CommandId, ScheduledCommandRecord>();

  async init(): Promise<void> {}

  async upsert(record: ScheduledCommandRecord): Promise<void> {
    this.records.set(record.commandId, record);
  }

  async get(commandId: CommandId): Promise<ScheduledCommandRecord | undefined> {
    return this.records.get(commandId);
  }

  async listResumable(): Promise<ReadonlyArray<ScheduledCommandRecord>> {
    return Array.from(this.records.values()).filter((record) =>
      ["pending", "running"].includes(record.status),
    );
  }

  async markStatus(
    commandId: CommandId,
    status: ScheduledCommandRecord["status"],
    patch: Partial<Pick<ScheduledCommandRecord, "attempts" | "lastError" | "scheduledAt">> = {},
  ): Promise<void> {
    const record = this.records.get(commandId);
    if (!record) return;
    this.records.set(commandId, { ...record, ...patch, status });
  }
}

const scheduled = (commandId: string, scheduledAt: string): ScheduledCommand => ({
  commandId: CommandId.make(commandId),
  scheduledAt,
  maxRetries: 1,
});

describe("SchedulerService", () => {
  it("schedules commands for future execution with Effect.TestClock", async () => {
    const dispatched: string[] = [];
    const store = new MemorySchedulerStore();
    const service = new SchedulerService(store, async (cmd) => {
      dispatched.push(cmd.commandId);
    });

    await service.schedule(
      command("cmd-1"),
      scheduled("cmd-1", new Date(Date.now() + 10).toISOString()),
    );
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(dispatched).toEqual(["cmd-1"]);
    expect((await store.get(CommandId.make("cmd-1")))?.status).toBe("completed");
  });

  it("does not execute cancelled commands", async () => {
    const dispatched: string[] = [];
    const store = new MemorySchedulerStore();
    const service = new SchedulerService(store, async (cmd) => {
      dispatched.push(cmd.commandId);
    });

    await service.schedule(
      command("cmd-2"),
      scheduled("cmd-2", new Date(Date.now() + 500).toISOString()),
    );
    await service.cancel(CommandId.make("cmd-2"));

    expect(dispatched).toEqual([]);
    expect((await store.get(CommandId.make("cmd-2")))?.status).toBe("cancelled");
  });

  it("reschedules without creating duplicate records", async () => {
    const store = new MemorySchedulerStore();
    const service = new SchedulerService(store, async () => undefined);

    await service.schedule(
      command("cmd-3"),
      scheduled("cmd-3", "2026-01-01T00:00:00.000Z"),
    );
    await service.reschedule(CommandId.make("cmd-3"), "2026-01-02T00:00:00.000Z");

    expect(store.records.size).toBe(1);
    expect((await store.get(CommandId.make("cmd-3")))?.scheduledAt).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("parses recurring cron-like intervals", () => {
    expect(parseRepeatIntervalMs("PT10S")).toBe(10_000);
    expect(parseRepeatIntervalMs("5m")).toBe(300_000);
    expect(parseRepeatIntervalMs("*/2 * * * *")).toBe(120_000);
  });
});
