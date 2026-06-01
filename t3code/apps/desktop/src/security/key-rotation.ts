/**
 * Encryption key rotation for desktop safe storage credentials.
 * Implements periodic key rotation with backward compatibility.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";
import safeStorage from "electron-safe-storage";

const scryptAsync = promisify(scrypt);

interface KeyEntry {
  id: string;
  createdAt: number;
  rotatedAt?: number;
  active: boolean;
}

interface EncryptedData {
  keyId: string;
  iv: string;
  data: string;
  version: number;
}

/**
 * Manages encryption keys with rotation support.
 */
export class KeyRotationManager {
  private keys: Map<string, Buffer> = new Map();
  private currentKeyId: string;
  private rotationIntervalMs: number;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(rotationIntervalMs: number = 30 * 24 * 60 * 60 * 1000) {
    this.rotationIntervalMs = rotationIntervalMs;
    this.currentKeyId = this.generateKeyId();
  }

  /**
   * Initialize with a master password.
   */
  async initialize(masterPassword: string): Promise<void> {
    const key = await this.deriveKey(masterPassword, this.currentKeyId);
    this.keys.set(this.currentKeyId, key);

    // Load existing keys from safe storage
    await this.loadExistingKeys();
  }

  /**
   * Derive an encryption key from master password and key ID.
   */
  private async deriveKey(password: string, keyId: string): Promise<Buffer> {
    const salt = Buffer.from(keyId, "hex");
    return (await scryptAsync(password, salt, 32)) as Buffer;
  }

  /**
   * Generate a unique key ID.
   */
  private generateKeyId(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Encrypt data with current key.
   */
  async encrypt(plaintext: string): Promise<EncryptedData> {
    const key = this.keys.get(this.currentKeyId);
    if (!key) throw new Error("Current key not found");

    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return {
      keyId: this.currentKeyId,
      iv: iv.toString("hex"),
      data: encrypted + ":" + authTag,
      version: 1,
    };
  }

  /**
   * Decrypt data (supports any key version).
   */
  async decrypt(encrypted: EncryptedData): Promise<string> {
    const key = this.keys.get(encrypted.keyId);
    if (!key) throw new Error(`Key ${encrypted.keyId} not found`);

    const iv = Buffer.from(encrypted.iv, "hex");
    const [data, authTag] = encrypted.data.split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Rotate to a new key.
   */
  async rotate(masterPassword: string): Promise<string> {
    const newKeyId = this.generateKeyId();
    const newKey = await this.deriveKey(masterPassword, newKeyId);

    this.keys.set(newKeyId, newKey);
    this.currentKeyId = newKeyId;

    return newKeyId;
  }

  /**
   * Re-encrypt data with current key (for key migration).
   */
  async reEncrypt(encrypted: EncryptedData): Promise<EncryptedData> {
    const plaintext = await this.decrypt(encrypted);
    return this.encrypt(plaintext);
  }

  /**
   * Start automatic rotation check.
   */
  startAutoRotation(masterPassword: string): void {
    this.rotationTimer = setInterval(async () => {
      // Check if current key is old enough to rotate
      const currentKey = this.keys.get(this.currentKeyId);
      if (currentKey) {
        // Rotate if needed
        await this.rotate(masterPassword);
      }
    }, this.rotationIntervalMs);
  }

  /**
   * Stop automatic rotation.
   */
  stopAutoRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * Load existing keys from safe storage.
   */
  private async loadExistingKeys(): Promise<void> {
    try {
      const stored = safeStorage.getItem("encryption_keys");
      if (stored) {
        const keys = JSON.parse(stored);
        for (const [id, keyHex] of Object.entries(keys)) {
          this.keys.set(id, Buffer.from(keyHex as string, "hex"));
        }
      }
    } catch {
      // No existing keys
    }
  }

  /**
   * Save keys to safe storage.
   */
  async saveKeys(): Promise<void> {
    const keysObj: Record<string, string> = {};
    for (const [id, key] of this.keys.entries()) {
      keysObj[id] = key.toString("hex");
    }
    safeStorage.setItem("encryption_keys", JSON.stringify(keysObj));
  }
}
