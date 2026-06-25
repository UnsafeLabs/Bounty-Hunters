import * as Schema from "effect/Schema";
import * as Either from "effect/Either";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./baseSchemas.ts";
import {
  ChatAttachment,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";
  "closed",
]);

// ProviderConfigError tagged error type
export class ProviderConfigError {
  readonly _tag = "ProviderConfigError";
  constructor(
    public readonly field: string,
    public readonly invalidValue: unknown,
    public readonly expectedFormat: string,
    public readonly message: string
  ) {}
}

// API key validation: non-empty, at least 10 characters
const ApiKeySchema = Schema.String.pipe(
  Schema.minLength(10, {
    message: () => "API key must be at least 10 characters long",
  }),
  Schema.pattern(/^\S+$/, {
    message: () => "API key cannot contain whitespace",
  })
);

// HTTPS URL validation
const HttpsUrlSchema = Schema.String.pipe(
  Schema.pattern(/^https:\/\/.+/, {
    message: () => "URL must use HTTPS protocol",
  }),
  Schema.pattern(/^https:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*[a-zA-Z0-9]?(\.[a-zA-Z0-9][-a-zA-Z0-9]*[a-zA-Z0-9]?)*\.[a-zA-Z]{2,}(\/.*)?$/, {
    message: () => "URL must have a valid hostname",
  })
);

// Provider configuration schema with runtime validation
export const ProviderConfig = Schema.Struct({
  apiKey: ApiKeySchema,
  endpoint: HttpsUrlSchema,
});
export type ProviderConfig = typeof ProviderConfig.Type;

// Validate a single field and return errors
function validateField<T>(
  name: string,
  value: unknown,
  schema: Schema.Schema<T, any>
): Either.Either<readonly ProviderConfigError[], T> {
  const result = Schema.decodeUnknownEither(schema)(value);
  if (Either.isLeft(result)) {
    Immutab
    return Either.left([
      new ProviderConfigError(
        name,
        value,
        "valid format",
        String(result.left)
      ),
    ]);
  }
  return Either.right(result.right);
}

// Validate provider config and return all errors at once
export function validateProviderConfig(
  config: unknown
): Either.Either<readonly ProviderConfigError[], ProviderConfig> {
  const decoded = Schema.decodeUnknownEither(ProviderConfig)(config);
  if (Either.isLeft(decoded)) {
    // Return the decode error as a single error for now
    // Effect Schema's decode already accumulates errors
    return Either.left([new ProviderConfigError("config", config, "valid provider config", String(decoded.left))]);
  }
  return Either.right(decoded.right);
}

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  "closed",
]);

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  // populates it (post-slice-4), routing flips to instance-id-only and the
  // legacy `provider` field is removed.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  runtimeMode: RuntimeMode,
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
