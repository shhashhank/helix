import { randomBytes } from 'node:crypto';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { LocalKms } from '../kms';
import { EncryptedSecretStore } from '../secret-store';
import { SecretsManagerSecretRecordRepository, secretsManagerRepoFromEnv } from '../aws-secrets-store';

const smMock = mockClient(SecretsManagerClient);
const awsError = (name: string): Error => Object.assign(new Error(name), { name });
const record = (over: Partial<{ scope: string; name: string }> = {}) => ({
  scope: 'acme',
  name: 'github-token',
  encryptedDataKey: Buffer.from([1, 2, 3]),
  ciphertext: Buffer.from([4, 5, 6]),
  updatedAt: '2026-06-14T00:00:00.000Z',
  ...over,
});

describe('SecretsManagerSecretRecordRepository', () => {
  beforeEach(() => smMock.reset());
  const repo = () => new SecretsManagerSecretRecordRepository({ prefix: 'helix/' });

  it('put creates a new secret named by prefix/scope/name with the record serialized', async () => {
    smMock.on(CreateSecretCommand).resolves({});
    await repo().put(record());

    const input = smMock.commandCalls(CreateSecretCommand)[0].args[0].input;
    expect(input.Name).toBe('helix/acme/github-token');
    expect(JSON.parse(input.SecretString as string)).toEqual({
      scope: 'acme',
      name: 'github-token',
      encryptedDataKey: Buffer.from([1, 2, 3]).toString('base64'),
      ciphertext: Buffer.from([4, 5, 6]).toString('base64'),
      updatedAt: '2026-06-14T00:00:00.000Z',
    });
  });

  it('put updates in place when the secret already exists', async () => {
    smMock.on(CreateSecretCommand).rejects(awsError('ResourceExistsException'));
    smMock.on(PutSecretValueCommand).resolves({});

    await repo().put(record());

    expect(smMock.commandCalls(PutSecretValueCommand)).toHaveLength(1);
    expect(smMock.commandCalls(PutSecretValueCommand)[0].args[0].input.SecretId).toBe('helix/acme/github-token');
  });

  it('get deserializes the record (buffers round-trip), and returns undefined when missing', async () => {
    smMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({
      scope: 'acme', name: 'k', encryptedDataKey: Buffer.from([7]).toString('base64'),
      ciphertext: Buffer.from([8]).toString('base64'), updatedAt: 'T',
    }) });
    const got = await repo().get('acme', 'k');
    expect(got).toEqual({ scope: 'acme', name: 'k', encryptedDataKey: Buffer.from([7]), ciphertext: Buffer.from([8]), updatedAt: 'T' });

    smMock.on(GetSecretValueCommand).rejects(awsError('ResourceNotFoundException'));
    expect(await repo().get('acme', 'missing')).toBeUndefined();
  });

  it('delete reports true on success and false when the secret is absent', async () => {
    smMock.on(DeleteSecretCommand).resolves({});
    expect(await repo().delete('acme', 'k')).toBe(true);
    expect(smMock.commandCalls(DeleteSecretCommand)[0].args[0].input.ForceDeleteWithoutRecovery).toBe(true);

    smMock.on(DeleteSecretCommand).rejects(awsError('ResourceNotFoundException'));
    expect(await repo().delete('acme', 'gone')).toBe(false);
  });

  it('list filters by the scope prefix, paginates, and strips back to names', async () => {
    smMock
      .on(ListSecretsCommand)
      .resolvesOnce({ SecretList: [{ Name: 'helix/acme/a' }], NextToken: 'page2' })
      .resolvesOnce({ SecretList: [{ Name: 'helix/acme/nested/b' }, { Name: 'other/x' }] });

    const refs = await repo().list('acme');

    expect(refs).toEqual([
      { scope: 'acme', name: 'a' },
      { scope: 'acme', name: 'nested/b' }, // names may contain slashes
    ]);
    expect(smMock.commandCalls(ListSecretsCommand)[0].args[0].input.Filters).toEqual([{ Key: 'name', Values: ['helix/acme/'] }]);
  });

  it('drops into EncryptedSecretStore unchanged — set persists to SM, get reads it back', async () => {
    let stored: string | undefined;
    smMock.on(CreateSecretCommand).callsFake((input) => {
      stored = input.SecretString;
      return {};
    });
    smMock.on(GetSecretValueCommand).callsFake(() => ({ SecretString: stored }));

    const store = new EncryptedSecretStore(new LocalKms(randomBytes(32)), repo());
    await store.setSecret({ scope: 'acme', name: 'token' }, 'ghs_secret');

    expect(stored).toBeDefined(); // ciphertext + wrapped key landed in Secrets Manager
    expect((await store.getSecret({ scope: 'acme', name: 'token' })).expose()).toBe('ghs_secret');
  });
});

describe('secretsManagerRepoFromEnv', () => {
  it('returns the SM repo when USE_AWS_SECRETS_MANAGER is truthy', () => {
    expect(secretsManagerRepoFromEnv({ USE_AWS_SECRETS_MANAGER: 'true' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      SecretsManagerSecretRecordRepository,
    );
  });

  it('returns undefined when the flag is unset/false (caller uses the in-memory repo)', () => {
    expect(secretsManagerRepoFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(secretsManagerRepoFromEnv({ USE_AWS_SECRETS_MANAGER: 'false' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
