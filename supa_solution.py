```typescript
// t3code/apps/server/errors.ts
import { TaggedEnum } from 'effect/data';

// Define a custom error class for ErrorData
export class ErrorData {
  static readonly NetworkError = new Error('NetworkError');
  static readonly DatabaseError = new Error('DatabaseError');
  static readonly AuthError = new Error('AuthError');
  static readonly GitError = new Error('GitError');
  static readonly ConfigError = new Error('ConfigError');
  static readonly ValidationErrors = new Error('ValidationErrors');

  constructor(public _tag: string, public message: string, public cause?: string, public timestamp: number) {
    this._tag = this.constructor.name;
  }
}

// Define a function to map error tags to HTTP status codes
export function errorToResponse(errorData: ErrorData): { status: number; message: string } {
  switch (errorData._tag) {
    case 'NetworkError':
      return { status: 400, message: 'Network error' };
    case 'DatabaseError':
      return { status: 500, message: 'Database error' };
    case 'AuthError':
      return { status: 401, message: 'Unauthorized' };
    case 'GitError':
      return { status: 404, message: 'Git repository not found' };
    case 'ConfigError':
      return { status: 400, message: 'Configuration error' };
    case 'ValidationErrors':
      return {
        status: 422,
        message: 'Validation errors',
        cause: Array.isArray(errorData.cause)
          ? JSON.stringify(errorData.cause.map((e) => e.message), ', ')
          : errorData.cause?.message,
      };
    default:
      throw new Error(`Unknown error type: ${errorData._tag}`);
  }
}

// Define a function to handle errors
export function handleError(errorData: ErrorData): never {
  console.error('Error:', errorData);
  // In production, you'd want to send the error to an error reporting service or logging service.
  throw new Error(`Internal Server Error: ${errorData.message}`);
}
```