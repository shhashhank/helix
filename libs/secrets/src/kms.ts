/**
 * Envelope-encryption key management (HELIX-90).
 *
 * Modeled directly on AWS KMS: the *master key* never leaves the key manager and
 * is never stored alongside the data it protects. Instead, each secret gets its
 * own random **data key**; the data key encrypts the secret, and the master key
 * encrypts (wraps) the data key. Only the wrapped data key + ciphertext are
 * persisted. To rotate to real AWS KMS later, implement {@link KeyManagementService}
 * with the AWS SDK and swap it in — nothing else changes (see DEFERRED.md).
 */
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  KEY_LENGTH_BYTES,
  packCiphertext,
  randomKey,
  unpackCiphertext,
} from './crypto';

/** A freshly minted data key: plaintext (use then discard) + wrapped (safe to store). */
export interface DataKey {
  /** The data key in the clear — use it immediately, do not persist. */
  plaintext: Buffer;
  /** The same data key wrapped by the master key — this is what gets stored. */
  encrypted: Buffer;
}

/** Mints and unwraps data keys without ever exposing the master key. */
export interface KeyManagementService {
  /** Generate a new random data key, returned both in the clear and wrapped. */
  generateDataKey(): Promise<DataKey>;
  /** Recover the plaintext of a previously wrapped data key. */
  decryptDataKey(encrypted: Buffer): Promise<Buffer>;
}

/**
 * Local KMS: one in-process 256-bit master key wraps/unwraps data keys with
 * AES-256-GCM. Good for dev, tests, and single-node deploys; for production on
 * AWS, replace with a KMS-backed implementation of {@link KeyManagementService}.
 */
export class LocalKms implements KeyManagementService {
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== KEY_LENGTH_BYTES) {
      throw new Error(`LocalKms master key must be ${KEY_LENGTH_BYTES} bytes, got ${masterKey.length}`);
    }
  }

  /** Build a LocalKms from a base64-encoded master key (e.g. sourced from config). */
  static fromBase64(base64MasterKey: string): LocalKms {
    return new LocalKms(Buffer.from(base64MasterKey, 'base64'));
  }

  /** Generate a brand-new master key (base64) for first-time setup. */
  static generateMasterKeyBase64(): string {
    return randomKey().toString('base64');
  }

  async generateDataKey(): Promise<DataKey> {
    const plaintext = randomKey();
    const encrypted = packCiphertext(aesGcmEncrypt(this.masterKey, plaintext));
    return { plaintext, encrypted };
  }

  async decryptDataKey(encrypted: Buffer): Promise<Buffer> {
    return aesGcmDecrypt(this.masterKey, unpackCiphertext(encrypted));
  }
}
