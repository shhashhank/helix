/**
 * Authenticated symmetric encryption primitives (AES-256-GCM) used by the vault.
 * GCM gives us confidentiality *and* integrity — a tampered ciphertext or wrong
 * key fails on the auth tag rather than silently returning garbage. Built on
 * Node's `crypto`, so there's nothing to install and it runs in offline CI.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // recommended GCM nonce size
const TAG_BYTES = 16; // GCM authentication tag size

/** AES-256 key length in bytes. */
export const KEY_LENGTH_BYTES = 32;

/** The three parts a GCM operation produces / needs. */
export interface AesGcmCiphertext {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

/** Encrypt `plaintext` under `key` with a fresh random IV. */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer): AesGcmCiphertext {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

/** Decrypt and verify; throws if the key is wrong or the data was tampered with. */
export function aesGcmDecrypt(key: Buffer, parts: AesGcmCiphertext): Buffer {
  assertKey(key);
  const decipher = createDecipheriv(ALGORITHM, key, parts.iv);
  decipher.setAuthTag(parts.authTag);
  return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
}

/** Flatten the three parts into one buffer (`iv || authTag || ciphertext`) for storage. */
export function packCiphertext(parts: AesGcmCiphertext): Buffer {
  return Buffer.concat([parts.iv, parts.authTag, parts.ciphertext]);
}

/** Inverse of {@link packCiphertext}. */
export function unpackCiphertext(packed: Buffer): AesGcmCiphertext {
  return {
    iv: packed.subarray(0, IV_BYTES),
    authTag: packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
    ciphertext: packed.subarray(IV_BYTES + TAG_BYTES),
  };
}

/** A cryptographically random AES-256 key (used for master keys and data keys). */
export function randomKey(): Buffer {
  return randomBytes(KEY_LENGTH_BYTES);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`AES-256-GCM key must be ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }
}
