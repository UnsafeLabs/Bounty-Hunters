 No markdown. Just the solution.
```ts
```ts
// t3code/apps/server/errors.ts
import { TaggedEnum } from 'effect/data';

// Define the error types using Effect.Data.TaggedEnum
const ErrorTag = TaggedEnum('error');
const NetworkError = ErrorTag('network');
const DatabaseError = ErrorTag('database');
const AuthError = ErrorTag('auth');
const GitError = ErrorTag('git');
const ConfigError = ErrorTag('config');
const ValidationError = ErrorTag('validation');

// Define the error structure
interface Error {
  _tag: string;
  message: string;
  cause?: string;
  timestamp: number;
}

// Helper function to map error tags to HTTP status codes
function errorToResponse(error: Error): { status: number; message: string } {
  switch (error._tag) {
    case 'network': return { status: 400, message: 'Network error' };
    case 'database': return { status: 500, message: 'Database error' };
    case 'auth': return { status: 401, message: 'Unauthorized' };
    case 'git': return { status: 404, message: 'Git repository not found' };
    case 'config': return { status: 400, message: 'Configuration error' };
    case 'validation': return { status: 400, message: '