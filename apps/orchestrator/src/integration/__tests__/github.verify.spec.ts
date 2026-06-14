import { generateKeyPairSync } from 'node:crypto';
import type { InstallationTokenExchanger } from '@helix/github-mcp/app-auth';
import { AppCredentialsGithubVerifier, UnconfiguredGithubVerifier, githubVerifierFromEnv } from '../github.verify';

/** A throwaway RSA private key (PEM) so `createAppJwt` can actually sign in the test. */
const rsaPrivateKey = (): string =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;

describe('UnconfiguredGithubVerifier', () => {
  it('honestly reports not_configured (cannot mint a token without an App)', async () => {
    const outcome = await new UnconfiguredGithubVerifier().verify('any-installation');
    expect(outcome).toEqual({ ok: false, status: 'not_configured', error: expect.any(String) });
  });
});

describe('AppCredentialsGithubVerifier', () => {
  const credentials = { appId: '123', privateKey: rsaPrivateKey() };

  it('mints a token for the installation and reports verified with the expiry', async () => {
    const exchange = jest.fn(async (_args: Parameters<InstallationTokenExchanger>[0]) => ({
      token: 'ghs_live',
      expiresAtMs: 1_725_000_000_000,
    }));
    const verifier = new AppCredentialsGithubVerifier(credentials, { exchange, now: () => 1_700_000_000_000 });

    const outcome = await verifier.verify('inst-42');

    expect(outcome).toEqual({ ok: true, status: 'verified', tokenExpiresAtMs: 1_725_000_000_000 });
    const call = exchange.mock.calls[0][0];
    expect(call.installationId).toBe('inst-42');
    expect(call.appJwt.split('.')).toHaveLength(3); // a signed App JWT (header.payload.signature)
  });

  it('maps any failure (bad key / revoked install / network) to an error outcome, not a throw', async () => {
    const exchange = jest.fn(async (_args: Parameters<InstallationTokenExchanger>[0]) => {
      throw new Error('401 Bad credentials');
    });
    const verifier = new AppCredentialsGithubVerifier(credentials, { exchange });

    await expect(verifier.verify('inst-42')).resolves.toEqual({ ok: false, status: 'error', error: '401 Bad credentials' });
  });
});

describe('githubVerifierFromEnv', () => {
  it('returns the live verifier when the App credentials are present', () => {
    const v = githubVerifierFromEnv({ GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: rsaPrivateKey() } as NodeJS.ProcessEnv);
    expect(v).toBeInstanceOf(AppCredentialsGithubVerifier);
  });

  it('falls back to the unconfigured verifier when a credential is missing', () => {
    expect(githubVerifierFromEnv({} as NodeJS.ProcessEnv)).toBeInstanceOf(UnconfiguredGithubVerifier);
    expect(githubVerifierFromEnv({ GITHUB_APP_ID: '123' } as NodeJS.ProcessEnv)).toBeInstanceOf(UnconfiguredGithubVerifier);
  });
});
