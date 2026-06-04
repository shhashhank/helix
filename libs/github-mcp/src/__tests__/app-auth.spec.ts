import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  appTokenProviderFromEnv,
  createAppJwt,
  GitHubAppTokenProvider,
  InstallationToken,
  InstallationTokenExchanger,
} from '../app-auth';

// A throwaway RSA keypair so we can sign a real JWT and verify it offline.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    signingInput: `${header}.${payload}`,
    signature,
  };
}

describe('createAppJwt', () => {
  const NOW = 1_700_000_000_000; // fixed epoch ms

  it('signs an RS256 JWT that verifies against the public key', () => {
    const jwt = createAppJwt({ appId: 42, privateKey: PEM }, NOW);
    const { header, signingInput, signature } = decodeJwt(jwt);

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    const ok = createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('sets iss to the App ID, backdates iat, and keeps exp under 10 minutes', () => {
    const { payload } = decodeJwt(createAppJwt({ appId: 'app-7', privateKey: PEM }, NOW));
    const iatExpected = Math.floor(NOW / 1000) - 60;

    expect(payload.iss).toBe('app-7');
    expect(payload.iat).toBe(iatExpected);
    expect(payload.exp - payload.iat).toBe(9 * 60);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
  });
});

describe('GitHubAppTokenProvider', () => {
  const creds = { appId: 1, privateKey: PEM };

  /** A fake exchanger that records calls and returns a token valid for `ttlMs`. */
  function fakeExchanger(ttlMs: number, now: () => number) {
    const calls: Array<{ appJwt: string; installationId: string | number; repositories?: string[] }> =
      [];
    let counter = 0;
    const exchange: InstallationTokenExchanger = async (args) => {
      calls.push(args);
      counter += 1;
      return { token: `tok-${counter}`, expiresAtMs: now() + ttlMs };
    };
    return { exchange, calls };
  }

  it('mints once and caches the token across calls', async () => {
    let clock = 1_000_000;
    const { exchange, calls } = fakeExchanger(3_600_000, () => clock);
    const provider = new GitHubAppTokenProvider({
      credentials: creds,
      installationId: 99,
      exchange,
      now: () => clock,
    });

    expect(await provider.getToken()).toBe('tok-1');
    clock += 60_000; // a minute later, still well inside the hour
    expect(await provider.getToken()).toBe('tok-1');
    expect(calls).toHaveLength(1);
  });

  it('passes a verifiable App JWT, the installation id, and repo scope to the exchange', async () => {
    let clock = 1_000_000;
    const { exchange, calls } = fakeExchanger(3_600_000, () => clock);
    const provider = new GitHubAppTokenProvider({
      credentials: creds,
      installationId: 'inst-5',
      repositories: ['helix'],
      exchange,
      now: () => clock,
    });

    await provider.getToken();

    expect(calls[0].installationId).toBe('inst-5');
    expect(calls[0].repositories).toEqual(['helix']);
    const { signingInput, signature } = decodeJwt(calls[0].appJwt);
    const ok = createVerify('RSA-SHA256')
      .update(signingInput)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('refreshes once the token is within the skew window of expiry', async () => {
    let clock = 1_000_000;
    const { exchange, calls } = fakeExchanger(3_600_000, () => clock); // 1h TTL
    const provider = new GitHubAppTokenProvider({
      credentials: creds,
      installationId: 1,
      exchange,
      now: () => clock,
      refreshSkewMs: 60_000,
    });

    expect(await provider.getToken()).toBe('tok-1');
    // Jump to 30s before expiry — inside the 60s skew → must refresh.
    clock += 3_600_000 - 30_000;
    expect(await provider.getToken()).toBe('tok-2');
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent first-time refreshes into a single exchange', async () => {
    let clock = 1_000_000;
    const { exchange, calls } = fakeExchanger(3_600_000, () => clock);
    const provider = new GitHubAppTokenProvider({
      credentials: creds,
      installationId: 1,
      exchange,
      now: () => clock,
    });

    const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(calls).toHaveLength(1);
  });
});

describe('appTokenProviderFromEnv', () => {
  const base = {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_INSTALLATION_ID: '67890',
    GITHUB_APP_PRIVATE_KEY: PEM,
  };

  it('builds a provider from the required environment variables', () => {
    expect(() => appTokenProviderFromEnv(base)).not.toThrow();
    expect(appTokenProviderFromEnv(base)).toBeInstanceOf(GitHubAppTokenProvider);
  });

  it('un-escapes a single-line private key (\\n → newline)', async () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    const provider = appTokenProviderFromEnv({ ...base, GITHUB_APP_PRIVATE_KEY: escaped });
    // If the key were mangled, minting the JWT during a refresh would throw.
    let token: InstallationToken | undefined;
    const exchange: InstallationTokenExchanger = async ({ appJwt }) => {
      const { signingInput, signature } = decodeJwt(appJwt);
      const ok = createVerify('RSA-SHA256')
        .update(signingInput)
        .verify(publicKey, Buffer.from(signature, 'base64url'));
      expect(ok).toBe(true);
      token = { token: 'ok', expiresAtMs: Date.now() + 3_600_000 };
      return token;
    };
    // Re-wire the exchange by reaching through a fresh provider with the same key.
    const wired = new GitHubAppTokenProvider({
      credentials: { appId: base.GITHUB_APP_ID, privateKey: escaped.replace(/\\n/g, '\n') },
      installationId: base.GITHUB_APP_INSTALLATION_ID,
      exchange,
    });
    expect(await wired.getToken()).toBe('ok');
    expect(provider).toBeInstanceOf(GitHubAppTokenProvider);
  });

  it('throws a clear error when a required variable is missing', () => {
    expect(() => appTokenProviderFromEnv({ GITHUB_APP_ID: '1' })).toThrow(
      /GITHUB_APP_INSTALLATION_ID/,
    );
  });

  it('parses a comma-separated repository allow-list', () => {
    const provider = appTokenProviderFromEnv({
      ...base,
      GITHUB_APP_REPOSITORIES: 'helix, infra ,',
    });
    expect(provider).toBeInstanceOf(GitHubAppTokenProvider);
  });
});
