/// <reference types="node" />

/**
 * Input type for password and salt parameters.
 * Accepts strings, Buffers, Uint8Arrays, and ArrayBufferViews (e.g. DataView).
 */
type BinaryLike = string | Buffer | Uint8Array | ArrayBufferView;

/**
 * Asynchronously derives a key using PBKDF2.
 *
 * @param password - The password to derive the key from.
 * @param salt - The cryptographic salt.
 * @param iterations - The number of iterations to perform.
 * @param keylen - The desired length of the derived key in bytes.
 * @param digest - The HMAC digest algorithm to use (e.g. `'sha1'`, `'sha256'`, `'sha512'`).
 * @param callback - Called with `(err, derivedKey)` upon completion.
 */
declare function pbkdf2(
	password: BinaryLike,
	salt: BinaryLike,
	iterations: number,
	keylen: number,
	digest: string,
	callback: (err: Error | null, derivedKey: Buffer) => void,
): void;

/**
 * Asynchronously derives a key using PBKDF2, defaulting to `'sha1'` digest.
 *
 * @param password - The password to derive the key from.
 * @param salt - The cryptographic salt.
 * @param iterations - The number of iterations to perform.
 * @param keylen - The desired length of the derived key in bytes.
 * @param callback - Called with `(err, derivedKey)` upon completion.
 */
declare function pbkdf2(
	password: BinaryLike,
	salt: BinaryLike,
	iterations: number,
	keylen: number,
	callback: (err: Error | null, derivedKey: Buffer) => void,
): void;

/**
 * Synchronously derives a key using PBKDF2.
 *
 * @param password - The password to derive the key from.
 * @param salt - The cryptographic salt.
 * @param iterations - The number of iterations to perform.
 * @param keylen - The desired length of the derived key in bytes.
 * @param digest - The HMAC digest algorithm to use (defaults to `'sha1'`).
 * @returns The derived key as a Buffer.
 */
declare function pbkdf2Sync(
	password: BinaryLike,
	salt: BinaryLike,
	iterations: number,
	keylen: number,
	digest?: string,
): Buffer;

export { pbkdf2, pbkdf2Sync };
