import {
  CredentialStore,
  MemoryKeychain,
  decrypt,
  encrypt,
  parseKeyVersion,
  runRotateKeysCli,
} from "./KeyRotation.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const kc = new MemoryKeychain("alpha-key");
const store = new CredentialStore(kc, () => "beta-key");
store.put("github", "token-1");
store.put("ssh", "secret-2");
assert(store.getPlain("github") === "token-1", "roundtrip");
assert(parseKeyVersion(store.list()[0]!.ciphertext) === 1, "v1");

const r = store.rotateKeys();
assert(r.ok && r.reencrypted === 2 && r.newVersion === 2, "rotated");
assert(store.getPlain("github") === "token-1", "after rotate");
assert(store.getPlain("ssh") === "secret-2", "after rotate 2");
assert(store.list().every((e) => e.keyVersion === 2), "all v2");
assert(kc.get(1) === undefined, "old key removed");
assert(kc.currentVersion() === 2, "current 2");

// Force atomic rollback: entry references missing key version with undecryptable payload
const storeFail = new CredentialStore(new MemoryKeychain("x"), () => "y");
storeFail.put("z", "Z");
(storeFail as any).entries.set("broken", {
  id: "broken",
  // valid base64 but wrong key version missing from keychain causes decrypt with fallback?
  // Use empty key material path: keyVersion 99 missing and ciphertext requires that key
  ciphertext: encrypt("secret", "other-key", 99),
  keyVersion: 99,
});
// Override decrypt path: rotate uses keychain.get(e.keyVersion) ?? oldKey — so it would use oldKey
// To force failure, poison generateKey to throw after first success path
const storeFail2 = new CredentialStore(new MemoryKeychain("x"), () => {
  throw new Error("keygen failed");
});
storeFail2.put("z", "Z");
const fail = storeFail2.rotateKeys();
assert(fail.ok === false && fail.rolledBack === true, "rollback");
assert(storeFail2.getPlain("z") === "Z", "old still readable");

const cli = runRotateKeysCli(store);
assert(cli.includes("OK") || cli.includes("reencrypted"), "cli");

const c = encrypt("hi", "k", 3);
assert(c.startsWith("v3:"), "prefix");
assert(decrypt(c, "k") === "hi", "dec");

console.log("KeyRotation tests: all passed");
