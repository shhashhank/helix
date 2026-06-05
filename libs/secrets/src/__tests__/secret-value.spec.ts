import { inspect } from 'node:util';
import { REDACTED_MARKER, SecretValue } from '../secret-value';

const PLAIN = 'ghp_super_secret_token_value_1234567890';

describe('SecretValue', () => {
  it('exposes the plaintext only via expose()', () => {
    const secret = new SecretValue(PLAIN);
    expect(secret.expose()).toBe(PLAIN);
    expect(secret.length).toBe(PLAIN.length);
  });

  it('redacts toString() and template interpolation', () => {
    const secret = new SecretValue(PLAIN);
    expect(secret.toString()).toBe(REDACTED_MARKER);
    expect(`token=${secret}`).toBe(`token=${REDACTED_MARKER}`);
  });

  it('redacts when JSON.stringify-ed inside an object', () => {
    const json = JSON.stringify({ apiKey: new SecretValue(PLAIN), other: 1 });
    expect(json).toContain(REDACTED_MARKER);
    expect(json).not.toContain(PLAIN);
  });

  it('redacts under util.inspect (what console.log uses)', () => {
    const rendered = inspect({ creds: new SecretValue(PLAIN) }, { depth: 5 });
    expect(rendered).not.toContain(PLAIN);
    expect(rendered).toContain(REDACTED_MARKER);
  });

  it('does not expose the plaintext as an enumerable property', () => {
    const secret = new SecretValue(PLAIN);
    expect(Object.values(secret)).not.toContain(PLAIN);
    expect(JSON.stringify(secret)).not.toContain(PLAIN);
  });
});
