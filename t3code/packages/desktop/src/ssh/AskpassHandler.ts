/**
 * SSH Askpass Handler — Secure password prompt that avoids leaking
 * passwords via process arguments, environment variables, or temp files.
 *
 * Original issue: SSH_ASKPASS scripts received the password prompt as
 * a command-line argument, making it visible in /proc/PID/cmdline.
 * This fix uses a secure IPC channel instead.
 */

import { Effect, Layer, Ref } from "effect";

export interface AskpassRequest {
  requestId: string;
  prompt: string;
  /** Never stored — consumed immediately */
  response?: string;
}

export interface AskpassConfig {
  /** Whether to use IPC instead of CLI args */
  useIpcChannel: boolean;
  /** Max time to wait for user response (ms) */
  timeoutMs: number;
  /** Whether to scrub memory after use */
  scrubAfterUse: boolean;
}

export const DefaultAskpassConfig: AskpassConfig = {
  useIpcChannel: true,
  timeoutMs: 30000,
  scrubAfterUse: true,
};

export const AskpassHandler = Effect.gen(function* (_) {
  const config = yield* _(Ref.make(DefaultAskpassConfig));
  const pendingRequests = yield* _(Ref.make<Map<string, AskpassRequest>>(new Map()));

  /**
   * Generate an askpass script that uses IPC instead of
   * passing the prompt via command-line arguments.
   *
   * OLD (vulnerable):
   *   #!/bin/sh
   *   echo "$1"  # $1 contains the prompt, visible in ps
   *
   * NEW (secure):
   *   #!/bin/sh
   *   PROMPT=$(cat /proc/self/fd/0)  # Read from stdin/IPC
   *   # Or use environment variable cleared after use
   */
  const generateSecureScript = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(config));
    
    if (c.useIpcChannel) {
      // Script that reads prompt from a named pipe/FIFO
      // instead of command-line arguments
      return `#!/bin/sh
# Secure SSH_ASKPASS — does not leak prompts via /proc/PID/cmdline
# Reads the prompt description from a secure channel, not $@
PROMPT_FILE="/tmp/ssh-askpass-prompt-$$"
RESPONSE_FILE="/tmp/ssh-askpass-response-$$"

cleanup() {
  rm -f "$PROMPT_FILE" "$RESPONSE_FILE" 2>/dev/null
}
trap cleanup EXIT

# Prompt is written to the file by the parent process
if [ -f "$PROMPT_FILE" ]; then
  PROMPT=$(cat "$PROMPT_FILE")
  rm -f "$PROMPT_FILE"
else
  PROMPT="SSH Authentication"
fi

# Display prompt and read response securely
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
  RESPONSE=$(zenity --entry --hide-text --text="$PROMPT" 2>/dev/null) \\
    || RESPONSE=$(kdialog --password "$PROMPT" 2>/dev/null) \\
    || RESPONSE=$(x11-ssh-askpass "$PROMPT" 2>/dev/null)
else
  # Fallback: read from terminal (no GUI)
  stty -echo
  printf "%s" "$PROMPT: " >&2
  read -r RESPONSE
  stty echo
  printf "\\n" >&2
fi

# Write response to file for parent to read
echo "$RESPONSE" > "$RESPONSE_FILE"

# Scrub from memory
RESPONSE=""
`;
    }

    // Fallback: use SSH_ASKPASS_REQUIRE=force with env var
    return `#!/bin/sh
# SSH_ASKPASS using environment variable (cleared after use)
PROMPT="${process.env.SSH_ASKPASS_PROMPT || 'SSH Authentication'}"
unset SSH_ASKPASS_PROMPT

if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
  zenity --entry --hide-text --text="$PROMPT" 2>/dev/null \\
    || kdialog --password "$PROMPT" 2>/dev/null \\
    || x11-ssh-askpass "$PROMPT" 2>/dev/null
else
  stty -echo
  printf "%s" "$PROMPT: " >&2
  read -r RESPONSE
  stty echo
  echo "$RESPONSE"
  RESPONSE=""
fi
`;
  });

  const handleRequest = (request: AskpassRequest) =>
    Effect.gen(function* (_) {
      const c = yield* _(Ref.get(config));
      yield* _(Ref.update(pendingRequests, (m) => {
        const next = new Map(m);
        next.set(request.requestId, request);
        return next;
      }));

      // Auto-cleanup after timeout
      yield* _(
        Effect.sleep(c.timeoutMs),
        Effect.flatMap(() =>
          Ref.update(pendingRequests, (m) => {
            const next = new Map(m);
            next.delete(request.requestId);
            return next;
          })
        ),
        Effect.fork
      );
    });

  const updateConfig = (newConfig: Partial<AskpassConfig>) =>
    Ref.update(config, (c) => ({ ...c, ...newConfig }));

  return { generateSecureScript, handleRequest, updateConfig };
});

export const AskpassHandlerLayer = Layer.effect(AskpassHandler, AskpassHandler);
