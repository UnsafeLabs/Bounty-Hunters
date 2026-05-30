# Standardize Server Error Types with Effect.Data.TaggedEnum
===========================================================

This bounty was fixed by creating a centralized error module that defines all server error types using Effect.Data.TaggedEnum. The goal is to standardize error handling across the server codebase.

## Approach
---------

1.  Create a new file `errors.ts` in `t3code/apps/server/src/errors.ts` to define all server error types.
2.  Define categories: NetworkError, DatabaseError, AuthError, GitError, ConfigError, ValidationError.
3.  Each error type should include `_tag`, `message`, and optional `cause` chain.
4.  Implement the `errorToResponse` function that maps error tags to HTTP status codes.
5.  Implement the `errorToLog` function that formats errors for structured logging.

## Code Changes
--------------

### errors.ts

```typescript
// Define all server error types using Effect.Data.TaggedEnum
import { TaggedEnum } from 'effect.data';

export const NetworkError = new TaggedEnum({
    _tag: 'NETWORK_ERROR',
    message: 'Failed to connect to the network.',
});

export const DatabaseError = new TaggedEnum({
    _tag: 'DATABASE_ERROR',
    message: 'An error occurred in the database.',
    cause: null, // Optional cause chain
});

export const AuthError = new TaggedEnum({
    _tag: 'AUTH_ERROR',
    message: 'Invalid authentication credentials.',
    cause: null, // Optional cause chain
});

export const GitError = new TaggedEnum({
    _tag: 'GIT_ERROR',
    message: 'Failed to initialize the Git repository.',
    cause: null, // Optional cause chain
});

export const ConfigError = new TaggedEnum({
    _tag: 'CONFIG_ERROR',
    message: 'Invalid configuration settings.',
    cause: null, // Optional cause chain
});

export const ValidationError = new TaggedEnum({
    _tag: 'VALIDATION_ERROR',
    message: 'Invalid request data.',
    cause: null, // Optional cause chain
});
```

### errorToResponse.ts

```typescript
// Map error tags to HTTP status codes
import { NetworkError } from './errors';
import { AuthError } from './errors';
import { ValidationError } from './errors';

const errorMap = {
    [NetworkError._tag]: 502, // Broken Gateway
    [AuthError._tag]: 401, // Unauthorized
    [ValidationError._tag]: 400, // Bad Request,
};

export function errorToResponse(error: any): number {
    if (error instanceof NetworkError) return errorMap[error._tag];
    if (error instanceof AuthError) return errorMap[error._tag];
    if (error instanceof ValidationError) return errorMap[error._tag];

    // If the error is not in the map, use a default 500 status code
    return 500;
}
```

### errorToLog.ts

```typescript
// Format errors for structured logging
import { NetworkError } from './errors';
import { AuthError } from './errors';
import { ValidationError } from './errors';

export function errorToLog(error: any): string {
    if (error instanceof NetworkError) {
        return `Network Error: ${error.message}`;
    }

    if (error instanceof AuthError) {
        return `Auth Error: ${error.message}`;
    }

    if (error instanceof ValidationError) {
        return `Validation Error: ${error.message}`;
    }

    // If the error is not an instance of one of our defined errors, return a generic error message
    return 'Unknown Error';
}
```

## Dependencies and Setup
------------------------

*   Install required dependencies: `effect.data` and any other third-party libraries used in this implementation.

This solution provides a centralized way to handle server errors using Effect.Data.TaggedEnum. The `errorToResponse` function maps error tags to HTTP status codes, while the `errorToLog` function formats errors for structured logging.