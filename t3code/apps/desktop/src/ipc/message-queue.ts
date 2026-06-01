/**
 * IPC message queuing for backend disconnect resilience.
 * Queues messages when backend is unavailable and replays on reconnect.
 */

interface QueuedMessage {
  id: string;
  channel: string;
  payload: unknown;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

export class IPCMessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private maxQueueSize: number;
  private maxRetries: number;

  constructor(maxQueueSize = 1000, maxRetries = 3) {
    this.maxQueueSize = maxQueueSize;
    this.maxRetries = maxRetries;
  }

  enqueue(channel: string, payload: unknown): string {
    const id = crypto.randomUUID();
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift(); // Drop oldest
    }
    this.queue.push({
      id, channel, payload,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: this.maxRetries,
    });
    return id;
  }

  async flush(sender: (channel: string, payload: unknown) => Promise<boolean>): Promise<number> {
    let sent = 0;
    const remaining: QueuedMessage[] = [];

    for (const msg of this.queue) {
      try {
        const ok = await sender(msg.channel, msg.payload);
        if (ok) {
          sent++;
        } else {
          msg.retries++;
          if (msg.retries < msg.maxRetries) remaining.push(msg);
        }
      } catch {
        msg.retries++;
        if (msg.retries < msg.maxRetries) remaining.push(msg);
      }
    }

    this.queue = remaining;
    return sent;
  }

  size(): number { return this.queue.length; }
  clear(): void { this.queue = []; }
}
