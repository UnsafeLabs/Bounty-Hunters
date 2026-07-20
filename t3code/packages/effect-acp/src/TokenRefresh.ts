/**
 * Automatic token refresh for ACP client (issue #829).
 *
 * Detects 401, runs onSessionExpired, re-auths once with refresh token,
 * queues concurrent callers during refresh, fails with AuthenticationError
 * if re-auth fails.
 */

export class AuthenticationError extends Error {
  readonly _tag = "AuthenticationError" as const;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AuthenticationError";
    this.cause = cause;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt?: number;
}

export interface TokenRefreshOptions {
  /** Called with expired session id before re-auth. */
  onSessionExpired?: (sessionId: string) => void | Promise<void>;
  /** Perform re-auth using refresh token; return new pair. */
  reauthenticate: (refreshToken: string, sessionId: string) => Promise<TokenPair>;
  /** Optional cleanup of old session resources (acquireRelease release). */
  releaseSession?: (sessionId: string) => void | Promise<void>;
  /** Max re-auth attempts after a 401 (acceptance: exactly once). */
  maxReauthAttempts?: number;
  now?: () => number;
}

export interface RequestResult<T> {
  status: number;
  body: T;
}

type Queued<T> = {
  execute: (accessToken: string) => Promise<RequestResult<T>>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

/**
 * Client-side session state with single-flight re-auth and request queue.
 */
export class TokenRefreshClient {
  private tokens: TokenPair;
  private refreshing: Promise<void> | null = null;
  private queue: Queued<unknown>[] = [];
  private readonly maxReauthAttempts: number;
  private readonly opts: TokenRefreshOptions;

  constructor(initial: TokenPair, opts: TokenRefreshOptions) {
    this.tokens = { ...initial };
    this.opts = opts;
    this.maxReauthAttempts = opts.maxReauthAttempts ?? 1;
  }

  get accessToken(): string {
    return this.tokens.accessToken;
  }

  get refreshToken(): string {
    return this.tokens.refreshToken;
  }

  get sessionId(): string {
    return this.tokens.sessionId;
  }

  /** True while a re-auth is in flight. */
  get isRefreshing(): boolean {
    return this.refreshing !== null;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Run a request with access token. On 401: re-auth once, retry.
   * Concurrent 401s share one re-auth and wait in queue.
   */
  async requestWithAuth<T>(
    execute: (accessToken: string) => Promise<RequestResult<T>>,
  ): Promise<T> {
    // If refresh already in flight, queue
    if (this.refreshing) {
      return this.enqueue(execute);
    }

    const first = await execute(this.tokens.accessToken);
    if (first.status !== 401) {
      return first.body;
    }

    // Single-flight re-auth
    await this.reauthOnce();
    const second = await execute(this.tokens.accessToken);
    if (second.status === 401) {
      throw new AuthenticationError("Re-authentication failed: still unauthorized");
    }
    return second.body;
  }

  private enqueue<T>(
    execute: (accessToken: string) => Promise<RequestResult<T>>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: execute as (t: string) => Promise<RequestResult<unknown>>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    });
  }

  /**
   * acquireRelease-style: release old session, reauth once, flush queue.
   */
  private async reauthOnce(): Promise<void> {
    if (this.refreshing) {
      await this.refreshing;
      return;
    }

    this.refreshing = (async () => {
      const oldSessionId = this.tokens.sessionId;
      const refreshTok = this.tokens.refreshToken;
      let attempts = 0;

      try {
        if (this.opts.onSessionExpired) {
          await this.opts.onSessionExpired(oldSessionId);
        }
        if (this.opts.releaseSession) {
          await this.opts.releaseSession(oldSessionId);
        }

        attempts += 1;
        if (attempts > this.maxReauthAttempts) {
          throw new AuthenticationError("Max re-auth attempts exceeded");
        }

        const next = await this.opts.reauthenticate(refreshTok, oldSessionId);
        this.tokens = { ...next };

        // Flush queue with new token
        const pending = this.queue.splice(0, this.queue.length);
        for (const item of pending) {
          try {
            const res = await item.execute(this.tokens.accessToken);
            if (res.status === 401) {
              item.reject(new AuthenticationError("Queued request still unauthorized after re-auth"));
            } else {
              item.resolve(res.body);
            }
          } catch (err) {
            item.reject(err);
          }
        }
      } catch (err) {
        const pending = this.queue.splice(0, this.queue.length);
        const authErr =
          err instanceof AuthenticationError
            ? err
            : new AuthenticationError("Re-authentication failed", err);
        for (const item of pending) {
          item.reject(authErr);
        }
        throw authErr;
      } finally {
        this.refreshing = null;
      }
    })();

    await this.refreshing;
  }
}

/** Schedule: attempt re-auth exactly once (for Effect.retry parity in tests). */
export function reauthScheduleAttempts(): number {
  return 1;
}

/** Detect 401 from status code. */
export function isUnauthorized(status: number): boolean {
  return status === 401;
}
