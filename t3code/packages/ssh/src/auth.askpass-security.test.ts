import {
  ASKPASS_POSIX_SCRIPT,
  ASKPASS_WINDOWS_SCRIPT,
  assertSafeAskpassPath,
} from "./auth.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// POSIX: mktemp + umask 077 + trap cleanup
assert(ASKPASS_POSIX_SCRIPT.includes("mktemp"), "mktemp");
assert(ASKPASS_POSIX_SCRIPT.includes("umask 077"), "umask 077 => 0600 files");
assert(ASKPASS_POSIX_SCRIPT.includes("trap cleanup EXIT INT TERM"), "trap signals");
assert(ASKPASS_POSIX_SCRIPT.includes('rm -f'), "cleanup removes temp");
assert(!/printf.*T3_SSH_AUTH_SECRET.*>\s*\/tmp/u.test(ASKPASS_POSIX_SCRIPT), "no secret to /tmp");

// Windows SecureString
assert(ASKPASS_WINDOWS_SCRIPT.includes("SecureString"), "SecureString");
assert(ASKPASS_WINDOWS_SCRIPT.includes("ConvertTo-SecureString"), "ConvertTo-SecureString");
assert(ASKPASS_WINDOWS_SCRIPT.includes("ZeroFreeBSTR"), "zero free bstr");

// Path validation
assertSafeAskpassPath("/tmp/t3code-ssh-askpass/ssh-askpass.sh");
let threw = false;
try {
  assertSafeAskpassPath("/tmp/bad path/ssh-askpass.sh");
} catch {
  threw = true;
}
assert(threw, "rejects spaces");
threw = false;
try {
  assertSafeAskpassPath("/tmp/evil;rm-rf/ssh-askpass.sh");
} catch {
  threw = true;
}
assert(threw, "rejects shell metacharacters");

console.log("askpass security tests: passed");
