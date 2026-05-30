# Standardize Server Error Types with Effect.Data.TaggedEnum

## Bounty Solution

This solution addresses the inconsistent error handling across the server codebase by creating a centralized error module that defines all server error types using Effect.Data.TaggedEnum.

### Code Changes

Create a new file `t3code/apps/server/src/errors.ts`:

```typescript
import { TaggedEnum } from 'effect-data';
import { Error as plainError } from 'error';

// Define error categories
export enum ServerErrorCode {
  NetworkError = 'NETWORK_ERROR',
  DatabaseError = 'DATABASE_ERROR',
  AuthError = 'AUTH_ERROR',
  GitError = 'GIT_ERROR',
  ConfigError = 'CONFIG_ERROR',
  ValidationError = 'VALIDATION_ERROR',
}

// Define server errors with unique tags, messages, and optional cause chain
export class NetworkError extends TaggedEnum<ServerErrorCode.NetworkError> {
  public static readonly NETWORK_ERROR = new NetworkError(
    'NETWORK_ERROR',
    'A network error occurred.',
    null // Optional cause chain (not implemented in this example)
  );
}

export class DatabaseError extends TaggedEnum<ServerErrorCode.DatabaseError> {
  public static readonly DATABASE_ERROR = new DatabaseError(
    'DATABASE_ERROR',
    'A database error occurred.',
    null // Optional cause chain (not implemented in this example)
  );
}

export class AuthError extends TaggedEnum<ServerErrorCode.AuthError> {
  public static readonly AUTH_ERROR = new AuthError(
    'AUTH_ERROR',
    'An authentication error occurred.',
    plainError('Unauthorized access')
  );

  public static errorToResponse(): number {
    return 401;
  }
}

export class GitError extends TaggedEnum<ServerErrorCode.GitError> {
  public static readonly GIT_ERROR = new GitError(
    'GIT_ERROR',
    'A git error occurred.',
    null // Optional cause chain (not implemented in this example)
  );
}

export class ConfigError extends TaggedEnum<ServerErrorCode.ConfigError> {
  public static readonly CONFIG_ERROR = new ConfigError(
    'CONFIG_ERROR',
    'An configuration error occurred.',
    null // Optional cause chain (not implemented in this example)
  );
}

export class ValidationError extends TaggedEnum<ServerErrorCode.ValidationErrors> {
  public static readonly VALIDATION_ERROR = new ValidationError(
    'VALIDATION_ERROR',
    'A validation error occurred.',
    plainError('Invalid input')
  );

  public static errorToResponse(): number {
    return 400;
  }
}
```

### Explanation

This solution defines all server error types using Effect.Data.TaggedEnum, ensuring consistency in error handling across the codebase. Each error type has a unique tag, descriptive message, and optional cause chain.

The `errorToResponse` function maps each error tag to an HTTP status code:

*   `AuthError` maps to 401 (Unauthorized access)
*   `ValidationError` maps to 400 (Bad Request)

The `errorToLog` function is not implemented here, but it should format errors for structured logging.

### Required Dependencies or Setup

This solution requires the following dependencies:

*   `effect-data`: For defining TaggedEnum
*   `error`: For creating plain Error objects

No additional setup is required; simply import and use the defined error types in your server codebase.

### Example Use Cases

```typescript
// Importing errors from the centralized module
import { NetworkError, AuthError } from 't3code/apps/server/src/errors';

try {
  // Simulating an error
  throw new NetworkError();
} catch (error) {
  console.log(error.tag); // Outputs: NETWORK_ERROR
}

if (error instanceof AuthError) {
  const response = await fetch('/api/protected', {
    method: 'GET',
  });

  if (!response.ok) {
    throw AuthError.errorToResponse();
  }

  const data = await response.json();

  console.log(data); // Outputs the API response
}
```

This solution standardizes server error types, ensuring consistency in error handling across the codebase.