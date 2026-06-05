import { randomKey } from '../crypto';
import { LocalKms } from '../kms';
import {
  EncryptedSecretStore,
  InMemorySecretRecordRepository,
  SecretNotFoundError,
} from '../secret-store';

const SCOPE = 'org-1';
const TOKEN = 'ghp_live_credential_should_never_persist_in_clear';

function newStore(masterKey = randomKey()) {
  const repo = new InMemorySecretRecordRepository();
  const kms = new LocalKms(masterKey);
  return { store: new EncryptedSecretStore(kms, repo), repo, masterKey };
}

describe('EncryptedSecretStore', () => {
  it('round-trips a secret through set/get', async () => {
    const { store } = newStore();
    await store.setSecret({ scope: SCOPE, name: 'github-app-key' }, TOKEN);
    const value = await store.getSecret({ scope: SCOPE, name: 'github-app-key' });
    expect(value.expose()).toBe(TOKEN);
  });

  it('persists only ciphertext — the plaintext never reaches the repository', async () => {
    const { store, repo } = newStore();
    await store.setSecret({ scope: SCOPE, name: 'k' }, TOKEN);

    const record = await repo.get(SCOPE, 'k');
    expect(record).toBeDefined();
    // Neither the encrypted secret nor the wrapped data key contain the plaintext.
    expect(record!.ciphertext.includes(Buffer.from(TOKEN, 'utf8'))).toBe(false);
    expect(JSON.stringify(record)).not.toContain(TOKEN);
  });

  it('uses a fresh data key per secret (envelope encryption)', async () => {
    const { store, repo } = newStore();
    await store.setSecret({ scope: SCOPE, name: 'a' }, 'value-a');
    await store.setSecret({ scope: SCOPE, name: 'b' }, 'value-b');
    const a = await repo.get(SCOPE, 'a');
    const b = await repo.get(SCOPE, 'b');
    expect(a!.encryptedDataKey.equals(b!.encryptedDataKey)).toBe(false);
  });

  it('throws SecretNotFoundError for an unknown ref', async () => {
    const { store } = newStore();
    await expect(store.getSecret({ scope: SCOPE, name: 'missing' })).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });

  it('deletes a secret (and reports whether one was removed)', async () => {
    const { store } = newStore();
    await store.setSecret({ scope: SCOPE, name: 'temp' }, 'x');
    expect(await store.deleteSecret({ scope: SCOPE, name: 'temp' })).toBe(true);
    expect(await store.deleteSecret({ scope: SCOPE, name: 'temp' })).toBe(false);
    await expect(store.getSecret({ scope: SCOPE, name: 'temp' })).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });

  it('lists secret refs within a scope only', async () => {
    const { store } = newStore();
    await store.setSecret({ scope: SCOPE, name: 'one' }, '1');
    await store.setSecret({ scope: SCOPE, name: 'two' }, '2');
    await store.setSecret({ scope: 'other-org', name: 'three' }, '3');

    const refs = await store.listSecrets(SCOPE);
    expect(refs.map((r) => r.name).sort()).toEqual(['one', 'two']);
    expect(refs.every((r) => r.scope === SCOPE)).toBe(true);
  });

  it('can be re-created over the same repo + master key and still decrypt (survives restart)', async () => {
    const { repo, masterKey } = newStore();
    const first = new EncryptedSecretStore(new LocalKms(masterKey), repo);
    await first.setSecret({ scope: SCOPE, name: 'persisted' }, TOKEN);

    const second = new EncryptedSecretStore(new LocalKms(masterKey), repo);
    expect((await second.getSecret({ scope: SCOPE, name: 'persisted' })).expose()).toBe(TOKEN);
  });

  it('cannot decrypt existing records with a different master key', async () => {
    const { repo, masterKey } = newStore();
    const writer = new EncryptedSecretStore(new LocalKms(masterKey), repo);
    await writer.setSecret({ scope: SCOPE, name: 'k' }, TOKEN);

    const wrongKeyReader = new EncryptedSecretStore(new LocalKms(randomKey()), repo);
    await expect(wrongKeyReader.getSecret({ scope: SCOPE, name: 'k' })).rejects.toThrow();
  });
});
