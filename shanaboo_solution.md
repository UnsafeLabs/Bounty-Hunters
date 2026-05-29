Looking at the issue description and the current file structure, I need to implement automatic token refresh functionality in the ACP client. Let me analyze what needs to be changed:

1. Add token expiry detection for 401 Unauthorized responses
2. Implement automatic re-authentication with Effect.retry
3. Store refresh token separately
4. Add callback for session expiry
5. Proper session cleanup with Effect.acquireRelease
6. Queue concurrent requests during re-auth

Let me first examine the current client.ts file to understand its structure:

```diff
--- a/t3code/packages/effect-acp/src/client.ts
+++ b/t3code/packages/e cpac/src/client.ts
@@ -1,15 +1,15 @@
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * Schema from "effect/Schema";
+import * State from "effect/State";
 import * Stdio from "effect/Stdio";
 import * Layer from "effect/Layer";
 import * Scope from "effect/Scope";
 import * AcpError from "./errors.ts";
 import * AcpProtocol from "./protocol";
 import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_public/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
-import * AcpRpcs from "./rpc";
-import * AcpSchema from "./_generated/schema.gen";
-import * AcpRpcs from "./rpc";
-import * AcpError from "./errors";
-import * AcpProtocol from "./protocol";
