import { Effect, Ref, Schedule, Layer } from "effect";

export interface QueuedMessage {
  id: string;
  channel: string;
  payload: unknown;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  status: "pending" | "sent" | "failed" | "delivered";
}

export interface QueueConfig {
  maxQueueSize: number;
  maxRetries: number;
  retryDelayMs: number;
  flushIntervalMs: number;
  persistToDisk: boolean;
}

export const DefaultQueueConfig: QueueConfig = {
  maxQueueSize: 1000,
  maxRetries: 3,
  retryDelayMs: 2000,
  flushIntervalMs: 5000,
  persistToDisk: true,
};

export const MessageQueue = Effect.gen(function* (_) {
  const queue = yield* _(Ref.make<QueuedMessage[]>([]));
  const config = yield* _(Ref.make(DefaultQueueConfig));
  let isConnected = false;

  const enqueue = (channel: string, payload: unknown) =>
    Effect.gen(function* (_) {
      const c = yield* _(Ref.get(config));
      const q = yield* _(Ref.get(queue));

      if (q.length >= c.maxQueueSize) {
        // Drop oldest pending message
        const trimmed = q.slice(1);
        yield* _(Ref.set(queue, trimmed));
      }

      const msg: QueuedMessage = {
        id: crypto.randomUUID(),
        channel,
        payload,
        timestamp: Date.now(),
        retryCount: 0,
        maxRetries: c.maxRetries,
        status: "pending",
      };

      if (isConnected) {
        // Try to send immediately
        msg.status = "sent";
      }

      yield* _(Ref.update(queue, (q) => [...q, msg]));
      return msg.id;
    });

  const flush = Effect.gen(function* (_) {
    if (!isConnected) return { flushed: 0, failed: 0 };

    const q = yield* _(Ref.get(queue));
    const pending = q.filter((m) => m.status === "pending" && m.retryCount < m.maxRetries);
    let flushed = 0;
    let failed = 0;

    for (const msg of pending) {
      // Simulate send — in production this calls the IPC channel
      const success = Math.random() > 0.1; // 90% success rate for demo

      if (success) {
        yield* _(Ref.update(queue, (q) =>
          q.map((m) => m.id === msg.id ? { ...m, status: "delivered" as const } : m)
        ));
        flushed++;
      } else {
        yield* _(Ref.update(queue, (q) =>
          q.map((m) => m.id === msg.id
            ? { ...m, retryCount: m.retryCount + 1, status: m.retryCount + 1 >= m.maxRetries ? "failed" as const : "pending" as const }
            : m)
        ));
        if (msg.retryCount + 1 >= msg.maxRetries) failed++;
      }
    }

    return { flushed, failed };
  });

  const setConnected = (connected: boolean) =>
    Effect.gen(function* (_) {
      isConnected = connected;
      if (connected) {
        // On reconnect, mark all pending as ready to flush
        yield* _(Ref.update(queue, (q) =>
          q.map((m) => m.status === "failed" && m.retryCount < m.maxRetries
            ? { ...m, status: "pending" as const }
            : m)
        ));
      }
    });

  const getStats = Effect.gen(function* (_) {
    const q = yield* _(Ref.get(queue));
    return {
      total: q.length,
      pending: q.filter((m) => m.status === "pending").length,
      delivered: q.filter((m) => m.status === "delivered").length,
      failed: q.filter((m) => m.status === "failed").length,
      isConnected,
    };
  });

  const clearDelivered = Effect.gen(function* (_) {
    yield* _(Ref.update(queue, (q) => q.filter((m) => m.status !== "delivered")));
  });

  // Start periodic flush
  const startFlushLoop = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(config));
    yield* _(
      Effect.repeat(flush, Schedule.spaced(c.flushIntervalMs)),
      Effect.fork
    );
  });

  return { enqueue, flush, setConnected, getStats, clearDelivered, startFlushLoop };
});

export const MessageQueueLayer = Layer.effect(MessageQueue, MessageQueue);
