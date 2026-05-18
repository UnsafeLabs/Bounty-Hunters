import { Effect, Schema, Ref } from "effect";

export const BranchProtectionConfig = Schema.Struct({
  protectedBranches: Schema.Array(Schema.String),
  enableForcePushDetection: Schema.Boolean,
  notifyOnForcePush: Schema.Boolean,
});

interface BranchProtectionStatus {
  branch: string;
  isProtected: boolean;
  forcePushDetected: boolean;
  lastCheck: number;
}

export const BranchProtectionMonitor = Effect.gen(function* (_) {
  const config = yield* _(
    Effect.config(BranchProtectionConfig).pipe(
      Effect.orElseSucceed(() => ({
        protectedBranches: ["main", "develop", "release/*"],
        enableForcePushDetection: true,
        notifyOnForcePush: true,
      }))
    )
  );

  const statusRef = yield* _(
    Ref.make<Record<string, BranchProtectionStatus>>({})
  );

  const checkBranchProtection = (branch: string, remoteProtection: boolean) =>
    Effect.gen(function* (_) {
      const isProtected = config.protectedBranches.some(
        (pattern) => branch === pattern || branch.match(new RegExp(pattern.replace("*", ".*")))
      );

      const status: BranchProtectionStatus = {
        branch,
        isProtected: isProtected && remoteProtection,
        forcePushDetected: false,
        lastCheck: Date.now(),
      };

      yield* _(Ref.update(statusRef, (s) => ({ ...s, [branch]: status })));
      return status;
    });

  const detectForcePush = (branch: string, oldHead: string, newHead: string) =>
    Effect.gen(function* (_) {
      if (!config.enableForcePushDetection) return false;

      // Force push: new head is not a descendant of old head
      const isForcePush = oldHead !== newHead;
      
      if (isForcePush) {
        yield* _(Ref.update(statusRef, (s) => ({
          ...s,
          [branch]: { ...s[branch], forcePushDetected: true },
        })));

        if (config.notifyOnForcePush) {
          console.warn(`[BranchProtection] Force push detected on ${branch}: ${oldHead} → ${newHead}`);
        }
      }

      return isForcePush;
    });

  const getStatus = (branch: string) =>
    Effect.gen(function* (_) {
      const statuses = yield* _(Ref.get(statusRef));
      return statuses[branch];
    });

  const getAllStatuses = Effect.gen(function* (_) {
    return yield* _(Ref.get(statusRef));
  });

  return { checkBranchProtection, detectForcePush, getStatus, getAllStatuses };
});
