import { createDefaultRedactor, REDACTED, Redactor } from '../redaction';
import { SecretValue } from '../secret-value';

describe('Redactor — pattern-based', () => {
  const r = createDefaultRedactor();

  it.each([
    ['GitHub classic token', 'token is ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['GitHub fine-grained', 'github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ'],
    ['OpenAI/Anthropic key', 'sk-ant-api03-AbCdEf012345_helloWorldToken'],
    ['AWS access key id', 'key AKIAIOSFODNN7EXAMPLE here'],
    ['JWT', 'jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'],
  ])('masks a %s', (_label, text) => {
    const out = r.redact(text);
    expect(out).toContain(REDACTED);
    // the high-entropy secret body should be gone
    expect(out).not.toMatch(/ghp_|github_pat_|sk-ant|AKIAIOSFODNN7EXAMPLE|SflKxwRJSMeKKF2QT4/);
  });

  it('keeps the scheme but masks a Bearer token', () => {
    expect(r.redact('Authorization: Bearer abc.def-ghi_123')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it('keeps the label but masks a secret=value pair', () => {
    expect(r.redact('api_key=supersecretvalue123')).toBe(`api_key=${REDACTED}`);
  });

  it('masks a PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(r.redact(`key:\n${pem}`)).toBe(`key:\n${REDACTED}`);
  });

  it('does not over-redact ordinary telemetry words', () => {
    // camelCase attribute-like words that merely contain "token" must survive.
    expect(r.redact('totalTokens=1234 inputTokens=10')).toBe('totalTokens=1234 inputTokens=10');
    expect(r.redact('hello world, status ok')).toBe('hello world, status ok');
  });
});

describe('Redactor — value-based', () => {
  it('scrubs an exact registered secret wherever it appears', () => {
    const secret = 'r3solved-cr3dential-value';
    const r = new Redactor({ values: [secret] });
    expect(r.redact(`header=${secret}; retry with ${secret}`)).toBe(
      `header=${REDACTED}; retry with ${REDACTED}`,
    );
  });

  it('ignores trivially short registered values (avoids over-redaction)', () => {
    const r = new Redactor({ values: ['abc'] });
    expect(r.redact('abc def abc')).toBe('abc def abc');
  });
});

describe('Redactor.redactDeep', () => {
  const r = new Redactor({ values: ['live-token-abcdefgh'] });

  it('walks objects and arrays, masking strings and preserving structure', () => {
    const input = {
      tool: 'github',
      args: { authorization: 'Bearer abc.def_123', note: 'live-token-abcdefgh' },
      counts: [1, 2, 3],
      ok: true,
    };
    const out = r.redactDeep(input) as typeof input;

    expect(out.tool).toBe('github');
    expect(out.args.authorization).toBe(`Bearer ${REDACTED}`);
    expect(out.args.note).toBe(REDACTED);
    expect(out.counts).toEqual([1, 2, 3]);
    expect(out.ok).toBe(true);
    // input is not mutated
    expect(input.args.note).toBe('live-token-abcdefgh');
  });

  it('masks a SecretValue to the redaction marker', () => {
    const out = r.redactDeep({ key: new SecretValue('top-secret') }) as unknown as { key: string };
    expect(out.key).toBe(REDACTED);
  });

  it('tolerates cyclic objects', () => {
    const a: Record<string, unknown> = { name: 'safe' };
    a.self = a;
    expect(() => r.redactDeep(a)).not.toThrow();
  });
});
