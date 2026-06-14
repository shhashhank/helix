/**
 * AWS Secrets Manager-backed {@link SecretRecordRepository} (HELIX-172, DEFERRED #2).
 *
 * The default {@link InMemorySecretRecordRepository} keeps encrypted records in a Map; this
 * persists them in **AWS Secrets Manager** instead — a drop-in for the repo seam, so
 * {@link EncryptedSecretStore} and its callers are unchanged. The vault still does the
 * envelope encryption (under a KMS or local data key); only ciphertext + the wrapped data
 * key are ever stored here, so Secrets Manager holds doubly-protected material.
 *
 * Each record is one Secrets Manager secret named `${prefix}${scope}/${name}`, with the
 * record serialized as a JSON `SecretString` (buffers base64-encoded). Kept out of the
 * `@helix/secrets` barrel (imported via the `@helix/secrets/aws-secrets-store` subpath) so
 * the AWS SDK only loads where AWS is actually wired.
 */
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { SecretRecord, SecretRecordRepository, SecretRef } from './secret-store';

const isAwsError = (err: unknown, name: string): boolean => err instanceof Error && err.name === name;

interface SerializedRecord {
  scope: string;
  name: string;
  encryptedDataKey: string;
  ciphertext: string;
  updatedAt: string;
}

const serialize = (r: SecretRecord): string =>
  JSON.stringify({
    scope: r.scope,
    name: r.name,
    encryptedDataKey: r.encryptedDataKey.toString('base64'),
    ciphertext: r.ciphertext.toString('base64'),
    updatedAt: r.updatedAt,
  } satisfies SerializedRecord);

const deserialize = (json: string): SecretRecord => {
  const o = JSON.parse(json) as SerializedRecord;
  return {
    scope: o.scope,
    name: o.name,
    encryptedDataKey: Buffer.from(o.encryptedDataKey, 'base64'),
    ciphertext: Buffer.from(o.ciphertext, 'base64'),
    updatedAt: o.updatedAt,
  };
};

export interface SecretsManagerStoreOptions {
  /** Name prefix that namespaces Helix's secrets (default `helix/`). */
  prefix?: string;
  /** An existing client (default: a new one using the ambient AWS config / region). */
  client?: SecretsManagerClient;
}

/** {@link SecretRecordRepository} that persists records in AWS Secrets Manager. */
export class SecretsManagerSecretRecordRepository implements SecretRecordRepository {
  private readonly client: SecretsManagerClient;
  private readonly prefix: string;

  constructor(options: SecretsManagerStoreOptions = {}) {
    this.client = options.client ?? new SecretsManagerClient({});
    this.prefix = options.prefix ?? 'helix/';
  }

  private secretName(scope: string, name: string): string {
    return `${this.prefix}${scope}/${name}`;
  }

  async get(scope: string, name: string): Promise<SecretRecord | undefined> {
    try {
      const out = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretName(scope, name) }));
      return out.SecretString ? deserialize(out.SecretString) : undefined;
    } catch (err) {
      if (isAwsError(err, 'ResourceNotFoundException')) return undefined;
      throw err;
    }
  }

  async put(record: SecretRecord): Promise<void> {
    const name = this.secretName(record.scope, record.name);
    const secretString = serialize(record);
    try {
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: secretString }));
    } catch (err) {
      // Already exists → update its value in place (idempotent upsert).
      if (isAwsError(err, 'ResourceExistsException')) {
        await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: secretString }));
      } else {
        throw err;
      }
    }
  }

  async delete(scope: string, name: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteSecretCommand({ SecretId: this.secretName(scope, name), ForceDeleteWithoutRecovery: true }),
      );
      return true;
    } catch (err) {
      if (isAwsError(err, 'ResourceNotFoundException')) return false;
      throw err;
    }
  }

  async list(scope: string): Promise<SecretRef[]> {
    const prefix = `${this.prefix}${scope}/`;
    const refs: SecretRef[] = [];
    let nextToken: string | undefined;
    do {
      const out = await this.client.send(
        new ListSecretsCommand({ Filters: [{ Key: 'name', Values: [prefix] }], NextToken: nextToken }),
      );
      for (const secret of out.SecretList ?? []) {
        if (secret.Name?.startsWith(prefix)) refs.push({ scope, name: secret.Name.slice(prefix.length) });
      }
      nextToken = out.NextToken;
    } while (nextToken);
    return refs;
  }
}

/**
 * Build a {@link SecretsManagerSecretRecordRepository} from the environment when
 * `USE_AWS_SECRETS_MANAGER` is truthy (prefix from `AWS_SECRETS_MANAGER_PREFIX`, default
 * `helix/`), else `undefined` so the caller falls back to the in-memory repository.
 */
export function secretsManagerRepoFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SecretRecordRepository | undefined {
  const flag = env.USE_AWS_SECRETS_MANAGER?.toLowerCase();
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') return undefined;
  return new SecretsManagerSecretRecordRepository({ prefix: env.AWS_SECRETS_MANAGER_PREFIX });
}
