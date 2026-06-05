import { KEY_LENGTH_BYTES, randomKey } from '../crypto';
import { LocalKms } from '../kms';

describe('LocalKms', () => {
  const masterKey = randomKey();
  const kms = new LocalKms(masterKey);

  it('generates a 256-bit data key returned both in the clear and wrapped', async () => {
    const { plaintext, encrypted } = await kms.generateDataKey();
    expect(plaintext).toHaveLength(KEY_LENGTH_BYTES);
    expect(encrypted.length).toBeGreaterThan(KEY_LENGTH_BYTES); // iv + tag + ciphertext
    expect(encrypted.includes(plaintext)).toBe(false); // wrapped form hides the key
  });

  it('round-trips a wrapped data key back to its plaintext', async () => {
    const { plaintext, encrypted } = await kms.generateDataKey();
    const recovered = await kms.decryptDataKey(encrypted);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('mints a fresh, distinct data key each call', async () => {
    const a = await kms.generateDataKey();
    const b = await kms.generateDataKey();
    expect(a.plaintext.equals(b.plaintext)).toBe(false);
    expect(a.encrypted.equals(b.encrypted)).toBe(false);
  });

  it('cannot unwrap a data key with a different master key', async () => {
    const { encrypted } = await kms.generateDataKey();
    const other = new LocalKms(randomKey());
    await expect(other.decryptDataKey(encrypted)).rejects.toThrow();
  });

  it('rejects a tampered wrapped data key (GCM auth tag)', async () => {
    const { encrypted } = await kms.generateDataKey();
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(kms.decryptDataKey(tampered)).rejects.toThrow();
  });

  it('builds from / generates a base64 master key', async () => {
    const b64 = LocalKms.generateMasterKeyBase64();
    const fromB64 = LocalKms.fromBase64(b64);
    const { plaintext, encrypted } = await fromB64.generateDataKey();
    expect((await fromB64.decryptDataKey(encrypted)).equals(plaintext)).toBe(true);
  });

  it('rejects a wrong-sized master key', () => {
    expect(() => new LocalKms(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});
