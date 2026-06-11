import { Effect, pipe } from 'effect';
import { AcpConfig } from './config';
import { AuthResponse, authenticate, refreshToken } from './auth';

interface AcpClientOptions {
  config: AcpConfig;
  authResponse: AuthResponse;
}

class AcpClient {
  private config: AcpConfig;
  private accessToken: string;
  private refreshToken: string;

  constructor(options: AcpClientOptions) {
    this.config = options.config;
    this.accessToken = options.authResponse.accessToken;
    this.refreshToken = options.authResponse.refreshToken;
  }

  private async reAuthenticate(): Promise<AuthResponse> {
    return refreshToken(this.config, this.refreshToken);
  }

  private async requestWithRetry<T>(request: () => Promise<T>): Promise<T> {
    const retryPolicy = Effect.retry({
      schedule: Effect.scheduleSpaced(1000).pipe(
        Effect.scheduleUnion(Effect.scheduleStop<number>(1))
      ),
      until: (error) => !(error instanceof Error && error.message.includes('401')),
    });

    return pipe(
      Effect.tryPromise(request),
      Effect.retry(retryPolicy),
      Effect.catchAll((error) => {
        if (error instanceof Error && error.message.includes('401')) {
          return Effect.tryPromise(async () => {
            const newAuthResponse = await this.reAuthenticate();
            this.accessToken = newAuthResponse.accessToken;
            return request();
          });
        }
        throw error;
      }),
      Effect.runPromise
    );
  }

  public async makeRequest<T>(request: () => Promise<T>): Promise<T> {
    return this.requestWithRetry(request);
  }
}

export const createAcpClient = (config: AcpConfig, authResponse: AuthResponse) => {
  return new AcpClient({ config, authResponse });
};