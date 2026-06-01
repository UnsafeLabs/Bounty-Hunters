/**
 * SSH tunnel keepalive and automatic reconnection with backoff.
 */

import { EventEmitter } from "events";
import { Client } from "ssh2";

interface TunnelConfig {
  host: string;
  port: number;
  username: string;
  privateKey: Buffer;
  remotePort: number;
  localPort: number;
  keepaliveInterval?: number;
  maxReconnectDelay?: number;
}

export class SSHTunnelManager extends EventEmitter {
  private client: Client | null = null;
  private config: TunnelConfig;
  private reconnectDelay = 1000;
  private maxReconnectDelay: number;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  constructor(config: TunnelConfig) {
    super();
    this.config = config;
    this.maxReconnectDelay = config.maxReconnectDelay || 30000;
  }

  async connect(): Promise<void> {
    this.client = new Client();

    this.client.on("ready", () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.emit("connected");
      this.startKeepalive();

      this.client!.forwardIn("0.0.0.0", this.config.remotePort, (err) => {
        if (err) {
          this.emit("error", err);
          this.scheduleReconnect();
        }
      });
    });

    this.client.on("close", () => {
      this.connected = false;
      this.stopKeepalive();
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    this.client.on("error", (err) => {
      this.emit("error", err);
    });

    this.client.connect({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      privateKey: this.config.privateKey,
      keepaliveInterval: this.config.keepaliveInterval || 10000,
      keepaliveCountMax: 3,
    });
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (!this.connected) {
        this.scheduleReconnect();
      }
    }, (this.config.keepaliveInterval || 10000) * 2);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  disconnect(): void {
    this.stopKeepalive();
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
