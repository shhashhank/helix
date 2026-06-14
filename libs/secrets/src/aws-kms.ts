/**
 * AWS KMS-backed {@link KeyManagementService} (HELIX-171, DEFERRED #2).
 *
 * The local {@link LocalKms} keeps a master key in-process; this backs the same envelope
 * scheme with **AWS KMS**, so the master key lives in KMS and never leaves it:
 * `generateDataKey` asks KMS for a fresh AES-256 data key (returned plaintext + KMS-wrapped),
 * and `decryptDataKey` asks KMS to unwrap a stored data key. Because the envelope shape
 * (`{ plaintext, encrypted }`) is identical to LocalKms, it's a **drop-in swap** —
 * {@link EncryptedSecretStore} and every secret consumer are unchanged.
 *
 * This module lives outside the `@helix/secrets` barrel (imported via the
 * `@helix/secrets/aws-kms` subpath) so the AWS SDK only loads where AWS is actually wired,
 * not in every secrets consumer.
 */
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import type { DataKey, KeyManagementService } from './kms';

export interface AwsKmsOptions {
  /** The KMS key id / ARN / alias that wraps the per-secret data keys. */
  keyId: string;
  /** An existing KMS client (default: a new one using the ambient AWS config / region). */
  client?: KMSClient;
}

/** {@link KeyManagementService} whose master key is an AWS KMS key. */
export class AwsKms implements KeyManagementService {
  private readonly client: KMSClient;
  private readonly keyId: string;

  constructor(options: AwsKmsOptions) {
    this.keyId = options.keyId;
    this.client = options.client ?? new KMSClient({});
  }

  async generateDataKey(): Promise<DataKey> {
    const out = await this.client.send(new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: 'AES_256' }));
    if (!out.Plaintext || !out.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned no key material');
    }
    return { plaintext: Buffer.from(out.Plaintext), encrypted: Buffer.from(out.CiphertextBlob) };
  }

  async decryptDataKey(encrypted: Buffer): Promise<Buffer> {
    const out = await this.client.send(new DecryptCommand({ CiphertextBlob: encrypted, KeyId: this.keyId }));
    if (!out.Plaintext) {
      throw new Error('KMS Decrypt returned no plaintext');
    }
    return Buffer.from(out.Plaintext);
  }
}

/**
 * Build an {@link AwsKms} from the environment when `AWS_KMS_KEY_ID` is set, else
 * `undefined` so the caller falls back to {@link LocalKms}. Region + credentials come from
 * the standard AWS SDK chain (env / shared config / instance role).
 */
export function awsKmsFromEnv(env: NodeJS.ProcessEnv = process.env): AwsKms | undefined {
  const keyId = env.AWS_KMS_KEY_ID;
  return keyId ? new AwsKms({ keyId }) : undefined;
}
