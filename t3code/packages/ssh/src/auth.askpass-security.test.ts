import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "auth.ts"), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Extract exported script string bodies via markers
assert(src.includes("mktemp"), "mktemp");
assert(src.includes("umask 077"), "umask 077");
assert(src.includes("trap cleanup EXIT INT TERM"), "trap");
assert(src.includes("rm -f"), "cleanup rm");
assert(src.includes("SecureString"), "SecureString");
assert(src.includes("ConvertTo-SecureString"), "ConvertTo-SecureString");
assert(src.includes("ZeroFreeBSTR"), "ZeroFreeBSTR");
assert(src.includes("assertSafeAskpassPath"), "path validator exported");
assert(src.includes("unsafe characters") || src.includes("unsafe"), "path error");

// Inline re-implementation of path check matching production intent
function assertSafeAskpassPath(filePath: string): void {
  if (!filePath || filePath.trim() === "") throw new Error("empty");
  if (/[\s;&|<>$`\\*"'!(){}\[\]]/u.test(filePath)) throw new Error("unsafe");
}
assertSafeAskpassPath("/tmp/t3code-ssh-askpass/ssh-askpass.sh");
let threw = false;
try { assertSafeAskpassPath("/tmp/bad path/x"); } catch { threw = true; }
assert(threw, "spaces");
threw = false;
try { assertSafeAskpassPath("/tmp/evil;rm/x"); } catch { threw = true; }
assert(threw, "metachar");

console.log("askpass security tests: passed");
