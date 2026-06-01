/**
 * ACP client with automatic session reconnection and exponential backoff.
 */

import { EventEmitter } from "events";

interface ACPConfig {
  url: string;
  token: string;
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

export class ACPClient extends EventEmitter {
  private config: Required<ACPConfig>;
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(config: ACPConfig) {
    super();
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? 10,
      baseDelay: config.baseDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
    };
  }

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.config.url);

    this.ws.onopen = () => {
      this.connected = true;
      this.retryCount = 0;
      this.emit("connected");
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      this.emit("error", err);
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.emit("message", data);
      } catch {
        this.emit("raw", msg.data);
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= this.config.maxRetries) {
      this.emit("maxRetriesReached");
      return;
    }

    const delay = Math.min(
      this.config.baseDelay * Math.pow(2, this.retryCount),
      this.config.maxDelay
    );

    this.reconnectTimer = setTimeout(() => {
      this.retryCount++;
      this.emit("reconnecting", this.retryCount);
      this.connect();
    }, delay);
  }

  send(data: unknown): void {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify(data));
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
