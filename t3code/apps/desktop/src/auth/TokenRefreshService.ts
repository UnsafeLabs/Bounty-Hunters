import { Effect, Schedule, Ref, Schema } from "effect";

export const RefreshTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Number,
  refresh_token: Schema.String,
});

export type RefreshTokenResponseType = Schema.Schema.Type<typeof RefreshTokenResponse>;

export const TokenRefreshConfig = Schema.Struct({
  refreshEndpoint: Schema.String,
  clientId: Schema.String,
  refreshBufferSeconds: Schema.Number.pipe(Schema.positive),
  maxRetries: Schema.Number.pipe(Schema.nonNegative),
  retryBaseDelay: Schema.Number.pipe(Schema.positive),
});

export type TokenRefreshConfigType = Schema.Schema.Type<typeof TokenRefreshConfig>;

export class TokenRefreshService extends Effect.Service<TokenRefreshService>()(
  "TokenRefreshService",
  {
    dependencies: [],
    effect: Effect.gen(function* (_) {
      const config = yield* _(Effect.config(TokenRefreshConfig));
      const currentToken = yield* _(Ref.make<RefreshTokenResponseType | null>(null));
      const isRefreshing = yield* _(Ref.make(false));

      const refreshWithRetry = (refreshToken: string) =>
        Effect.gen(function* (_) {
          const schedule = Schedule.exponential(
            Schedule.Duration.millis(config.retryBaseDelay),
            2.0
          ).pipe(Schedule.compose(Schedule.recurs(config.maxRetries)));

          const result = yield* _(
            Effect.tryPromise({
              try: async () => {
                const response = await fetch(config.refreshEndpoint, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: refreshToken,
                    client_id: config.clientId,
                  }).toString(),
                });

                if (!response.ok) {
                  throw new Error(`Token refresh failed: ${response.status}`);
                }

                return response.json();
              },
              catch: (e) => new Error(`Refresh error: ${e}`),
            }).pipe(Schedule.retry(schedule))
          );

          const validated = Schema.decodeUnknownSync(RefreshTokenResponse)(result);
          yield* _(Ref.set(currentToken, validated));
          return validated;
        });

      const getValidToken = () =>
        Effect.gen(function* (_) {
          const token = yield* _(Ref.get(currentToken));

          if (!token) {
            return yield* _(Effect.fail(new Error("No token available")));
          }

          // Check if token needs refresh (with buffer)
          const expiresAt = token.expires_in * 1000 - config.refreshBufferSeconds * 1000;
          const needsRefresh = Date.now() >= expiresAt;

          if (!needsRefresh) {
            return token;
          }

          // Prevent concurrent refreshes
          const alreadyRefreshing = yield* _(Ref.get(isRefreshing));
          if (alreadyRefreshing) {
            // Wait for the other refresh to complete
            yield* _(Effect.sleep(Schedule.Duration.millis(100)));
            return yield* _(Ref.get(currentToken))!;
          }

          yield* _(Ref.set(isRefreshing, true));
          try {
            const newToken = yield* _(refreshWithRetry(token.refresh_token));
            return newToken;
          } finally {
            yield* _(Ref.set(isRefreshing, false));
          }
        });

      const setToken = (token: RefreshTokenResponseType) =>
        Ref.set(currentToken, token);

      return { getValidToken, setToken, refreshWithRetry };
    }),
  }
) {}
