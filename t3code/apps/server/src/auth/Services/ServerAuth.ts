import type {
  AuthBearerBootstrapResult,
  AuthBootstrapResult,
  AuthClientMetadata,
  AuthClientSession,
  AuthCreatePairingCredentialInput,
  AuthPairingLink,
  AuthPairingCredentialResult,
  AuthSessionId,
  AuthSessionState,
  ServerAuthDescriptor,
  ServerAuthSessionMethod,
  AuthWebSocketTokenResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type { SessionRole } from "./SessionCredentialService.ts";
import { ServerError } from "../../errors.ts";

export interface AuthenticatedSession {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly role: SessionRole;
  readonly expiresAt?: DateTime.DateTime;
}

export interface ServerAuthShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthSessionState, never>;
  readonly exchangeBootstrapCredential: (
    credential: string,
    requestMetadata: AuthClientMetadata,
  ) => Effect.Effect<
    {
      readonly response: AuthBootstrapResult;
      readonly sessionToken: string;
    },
    ServerError
  >;
  readonly exchangeBootstrapCredentialForBearerSession: (
    credential: string,
    requestMetadata: AuthClientMetadata,
  ) => Effect.Effect<AuthBearerBootstrapResult, ServerError>;
  readonly issuePairingCredential: (
    input?: AuthCreatePairingCredentialInput & {
      readonly role?: SessionRole;
    },
  ) => Effect.Effect<AuthPairingCredentialResult, ServerError>;
  readonly listPairingLinks: () => Effect.Effect<ReadonlyArray<AuthPairingLink>, ServerError>;
  readonly revokePairingLink: (id: string) => Effect.Effect<boolean, ServerError>;
  readonly listClientSessions: (
    currentSessionId: AuthSessionId,
  ) => Effect.Effect<ReadonlyArray<AuthClientSession>, ServerError>;
  readonly revokeClientSession: (
    currentSessionId: AuthSessionId,
    targetSessionId: AuthSessionId,
  ) => Effect.Effect<boolean, ServerError>;
  readonly revokeOtherClientSessions: (
    currentSessionId: AuthSessionId,
  ) => Effect.Effect<number, ServerError>;
  readonly authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, ServerError>;
  readonly authenticateWebSocketUpgrade: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, ServerError>;
  readonly issueWebSocketToken: (
    session: AuthenticatedSession,
  ) => Effect.Effect<AuthWebSocketTokenResult, ServerError>;
  readonly issueStartupPairingUrl: (baseUrl: string) => Effect.Effect<string, ServerError>;
}

export class ServerAuth extends Context.Service<ServerAuth, ServerAuthShape>()(
  "t3/auth/Services/ServerAuth",
) {}
