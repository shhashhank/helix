import { randomBytes } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { mockClient } from 'aws-sdk-client-mock';
import { AwsKms, awsKmsFromEnv } from '../aws-kms';
import { EncryptedSecretStore, InMemorySecretRecordRepository } from '../secret-store';

const kmsMock = mockClient(KMSClient);

describe('AwsKms', () => {
  beforeEach(() => kmsMock.reset());

  it('generateDataKey asks KMS for an AES-256 data key and returns plaintext + wrapped', async () => {
    kmsMock.on(GenerateDataKeyCommand).resolves({ Plaintext: new Uint8Array([1, 2, 3]), CiphertextBlob: new Uint8Array([9, 9]) });

    const dk = await new AwsKms({ keyId: 'alias/helix' }).generateDataKey();

    expect(dk.plaintext).toEqual(Buffer.from([1, 2, 3]));
    expect(dk.encrypted).toEqual(Buffer.from([9, 9]));
    expect(kmsMock.commandCalls(GenerateDataKeyCommand)[0].args[0].input).toEqual({ KeyId: 'alias/helix', KeySpec: 'AES_256' });
  });

  it('decryptDataKey unwraps a stored data key via KMS Decrypt', async () => {
    kmsMock.on(DecryptCommand).resolves({ Plaintext: new Uint8Array([4, 5, 6]) });

    const pt = await new AwsKms({ keyId: 'alias/helix' }).decryptDataKey(Buffer.from([9, 9]));

    expect(pt).toEqual(Buffer.from([4, 5, 6]));
    const input = kmsMock.commandCalls(DecryptCommand)[0].args[0].input;
    expect(input.KeyId).toBe('alias/helix');
    expect(Buffer.from(input.CiphertextBlob as Uint8Array)).toEqual(Buffer.from([9, 9]));
  });

  it('throws if KMS returns no key material', async () => {
    kmsMock.on(GenerateDataKeyCommand).resolves({});
    await expect(new AwsKms({ keyId: 'k' }).generateDataKey()).rejects.toThrow(/no key material/);
  });

  it('drops into EncryptedSecretStore unchanged — a full envelope round-trip', async () => {
    const dataKey = randomBytes(32); // a real AES-256 key, as KMS would mint
    kmsMock.on(GenerateDataKeyCommand).resolves({ Plaintext: new Uint8Array(dataKey), CiphertextBlob: new Uint8Array([7, 7, 7]) });
    kmsMock.on(DecryptCommand).resolves({ Plaintext: new Uint8Array(dataKey) });

    const store = new EncryptedSecretStore(new AwsKms({ keyId: 'alias/helix' }), new InMemorySecretRecordRepository());
    await store.setSecret({ scope: 'acme', name: 'github-token' }, 'ghs_secret');

    const value = await store.getSecret({ scope: 'acme', name: 'github-token' });
    expect(value.expose()).toBe('ghs_secret');
  });
});

describe('awsKmsFromEnv', () => {
  it('returns an AwsKms when AWS_KMS_KEY_ID is set', () => {
    expect(awsKmsFromEnv({ AWS_KMS_KEY_ID: 'alias/helix' } as NodeJS.ProcessEnv)).toBeInstanceOf(AwsKms);
  });

  it('returns undefined when unset (the caller falls back to LocalKms)', () => {
    expect(awsKmsFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
