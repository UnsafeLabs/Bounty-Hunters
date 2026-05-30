import { createEffect, effects } from 'effectjs';
import { AcpClientOptions } from 't3code/packages/effect-acp/src/client';

const autoRefresh = createEffect(
  {
    deps: [token],
    onRun: (token) => {
      const refreshInterval = 5 * 60 * 1000; // 5 minutes
      const retryDelay = 500; // 500ms

      createPeriodic(
        () => {
          if (!token.hasExpire()) return;

          token.refresh();
        },
        refreshInterval,
        null
      );

      createPeriodic(
        () => {
          if (token.hasExpire()) return;

          const retry = new Effect.retry(() => {
            token.tryRefresh();
          }, retryDelay);

          effect.run(retry);
        },
        1 * 60 * 1000, // 1 minute
        null
      );
    }
  },
  [token],
);

const onSessionExpired = (options: AcpClientOptions) => {
  if (!options.onSessionExpired) return;

  options.onSessionExpired();
};

export default autoRefresh;