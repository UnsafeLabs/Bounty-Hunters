/**
 * Encryption key rotation for desktop safe storage credentials (issue #848).
 */

export interface CredentialEntry {
  id: string;
  ciphertext: string;
  keyVersion: number;
}

export interface KeychainLike {
  get(version: number): string | undefined;
  set(version: number, key: string): void;
  delete(version: number): void;
  currentVersion(): number;
  setCurrentVersion(v: number): void;
}

export class MemoryKeychain implements KeychainLike {
  private keys = new Map<number, string>();
  private current = 1;

  constructor(initialKey = "key-v1") {
    this.keys.set(1, initialKey);
    this.current = 1;
  }

  get(version: number): string | undefined {
    return this.keys.get(version);
  }
  set(version: number, key: string): void {
    this.keys.set(version, key);
  }
  delete(version: number): void {
    this.keys.delete(version);
  }
  currentVersion(): number {
    return this.current;
  }
  setCurrentVersion(v: number): void {
    this.current = v;
  }
}

/** Toy encrypt/decrypt using XOR + version prefix (tests only; not crypto-secure). */
export function encrypt(plain: string, key: string, version: number): string {
  const raw = Buffer.from(plain, "utf8");
  const k = Buffer.from(key, "utf8");
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i]! ^ k[i % k.length]!;
  return `v${version}:${out.toString("base64")}`;
}

export function decrypt(ciphertext: string, key: string): string {
  const idx = ciphertext.indexOf(":");
  const b64 = idx >= 0 ? ciphertext.slice(idx + 1) : ciphertext;
  const raw = Buffer.from(b64, "base64");
  const k = Buffer.from(key, "utf8");
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i]! ^ k[i % k.length]!;
  return out.toString("utf8");
}

export function parseKeyVersion(ciphertext: string): number {
  const m = /^v(\d+):/.exec(ciphertext);
  return m ? Number(m[1]) : 1;
}

export interface RotationResult {
  ok: boolean;
  reencrypted: number;
  newVersion: number;
  rolledBack: boolean;
  log: string;
}

export class CredentialStore {
  private entries = new Map<string, CredentialEntry>();
  private keychain: KeychainLike;
  private generateKey: () => string;

  constructor(keychain: KeychainLike, generateKey: () => string = () => `key-${Date.now()}`) {
    this.keychain = keychain;
    this.generateKey = generateKey;
  }

  put(id: string, plain: string): CredentialEntry {
    const v = this.keychain.currentVersion();
    const key = this.keychain.get(v);
    if (!key) throw new Error("missing current key");
    const entry: CredentialEntry = {
      id,
      ciphertext: encrypt(plain, key, v),
      keyVersion: v,
    };
    this.entries.set(id, entry);
    return { ...entry };
  }

  getPlain(id: string): string | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    const key = this.keychain.get(e.keyVersion);
    if (!key) throw new Error(`missing key v${e.keyVersion}`);
    return decrypt(e.ciphertext, key);
  }

  list(): CredentialEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  /**
   * Atomic rotation: re-encrypt all with new key; on failure restore snapshot.
   */
  rotateKeys(): RotationResult {
    const oldVersion = this.keychain.currentVersion();
    const oldKey = this.keychain.get(oldVersion);
    if (!oldKey) throw new Error("no current key");

    const snapshot = this.list().map((e) => ({ ...e }));
    const newVersion = oldVersion + 1;
    const newKey = this.generateKey();
    this.keychain.set(newVersion, newKey);

    let reencrypted = 0;
    try {
      for (const e of snapshot) {
        const k = this.keychain.get(e.keyVersion) ?? oldKey;
        const plain = decrypt(e.ciphertext, k);
        const next: CredentialEntry = {
          id: e.id,
          ciphertext: encrypt(plain, newKey, newVersion),
          keyVersion: newVersion,
        };
        this.entries.set(e.id, next);
        reencrypted += 1;
      }
      this.keychain.setCurrentVersion(newVersion);
      this.keychain.delete(oldVersion);
      const log = `key-rotation ts=${new Date().toISOString()} reencrypted=${reencrypted} newVersion=${newVersion}`;
      return { ok: true, reencrypted, newVersion, rolledBack: false, log };
    } catch (err) {
      this.entries.clear();
      for (const e of snapshot) this.entries.set(e.id, e);
      this.keychain.delete(newVersion);
      this.keychain.setCurrentVersion(oldVersion);
      return {
        ok: false,
        reencrypted: 0,
        newVersion: oldVersion,
        rolledBack: true,
        log: `key-rotation FAILED rolled back: ${err}`,
      };
    }
  }
}

export function runRotateKeysCli(store: CredentialStore): string {
  const r = store.rotateKeys();
  return [
    r.ok ? "OK" : "FAILED",
    `reencrypted=${r.reencrypted}`,
    `version=${r.newVersion}`,
    r.rolledBack ? "rolledBack=true" : "rolledBack=false",
    r.log,
  ].join(" ");
}
