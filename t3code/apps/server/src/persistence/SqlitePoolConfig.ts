import * as Duration from "effect/Duration";

export const sqlitePoolDefaults = {
  min: 1,
  max: 5,
  acquireTimeout: Duration.seconds(10),
  timeToLive: Duration.minutes(5),
} as const;
