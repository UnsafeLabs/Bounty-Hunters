import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { validateEnvironment } from "../envValidation.ts";

export const validateConfigCommand = Command.make("validate-config").pipe(
  Command.withDescription(
    "Validate all environment variables and exit without starting the server.",
  ),
  Command.withHandler(() =>
    Effect.gen(function* () {
      yield* validateEnvironment;
    }),
  ),
);
