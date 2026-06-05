import { SecretNotFoundError, SecretValue } from '@helix/secrets';
import type { SecretRef, SecretsManager } from '@helix/secrets';
import { resolveTransportCredentials } from '../credentials';
import { injectResolvedSecrets, McpServerRegistry } from '../registry';

/** A minimal in-memory vault keyed by `scope/name`. */
function vault(entries: Record<string, string>): SecretsManager {
  return {
    async getSecret(ref: SecretRef): Promise<SecretValue> {
      const key = `${ref.scope}/${ref.name}`;
      if (!(key in entries)) throw new SecretNotFoundError(ref);
      return new SecretValue(entries[key]);
    },
    async setSecret() {
      /* unused */
    },
    async deleteSecret() {
      return true;
    },
    async listSecrets() {
      return [];
    },
  };
}

describe('resolveTransportCredentials', () => {
  it('resolves env + header refs to plaintext at call time', async () => {
    const secrets = vault({ 'org-1/api-token': 'sk-live-123', 'org-1/gh-header': 'Bearer abc' });
    const resolved = await resolveTransportCredentials(
      {
        env: { API_KEY: { scope: 'org-1', name: 'api-token' } },
        headers: { Authorization: { scope: 'org-1', name: 'gh-header' } },
      },
      secrets,
    );
    expect(resolved.env).toEqual({ API_KEY: 'sk-live-123' });
    expect(resolved.headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('returns empty maps when there are no credentials', async () => {
    expect(await resolveTransportCredentials(undefined, vault({}))).toEqual({ env: {}, headers: {} });
  });

  it('fails closed if a required secret is missing', async () => {
    await expect(
      resolveTransportCredentials({ env: { X: { scope: 'o', name: 'absent' } } }, vault({})),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});

describe('injectResolvedSecrets', () => {
  it('merges resolved env into a stdio config, strips credentials, and does not mutate the input', () => {
    const config = {
      type: 'stdio' as const,
      command: 'node',
      args: ['server.js'],
      env: { LOG_LEVEL: 'info' },
      credentials: { env: { TOKEN: { scope: 'o', name: 't' } } },
    };
    const injected = injectResolvedSecrets(config, { env: { TOKEN: 'secret-xyz' }, headers: {} });

    expect(injected).toMatchObject({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { LOG_LEVEL: 'info', TOKEN: 'secret-xyz' },
      credentials: undefined,
    });
    // Original config still holds only the reference — never the plaintext.
    expect(config.credentials.env.TOKEN).toEqual({ scope: 'o', name: 't' });
    expect(JSON.stringify(config)).not.toContain('secret-xyz');
  });

  it('merges resolved headers into an http config', () => {
    const config = {
      type: 'http' as const,
      url: 'https://tools.example.com/mcp',
      headers: { 'X-Trace': '1' },
      credentials: { headers: { Authorization: { scope: 'o', name: 'h' } } },
    };
    const injected = injectResolvedSecrets(config, { env: {}, headers: { Authorization: 'Bearer t' } });
    expect(injected).toMatchObject({
      type: 'http',
      url: 'https://tools.example.com/mcp',
      headers: { 'X-Trace': '1', Authorization: 'Bearer t' },
      credentials: undefined,
    });
  });
});

describe('registry stores only references (secrets never persisted)', () => {
  it('keeps credential refs in the stored config and never holds plaintext', () => {
    // A connector that must never run for this test (we only inspect stored state).
    const registry = new McpServerRegistry(async () => {
      throw new Error('connector should not be called');
    });
    registry.register({
      id: 'github',
      transport: {
        type: 'stdio',
        command: 'helix-github',
        credentials: { env: { GITHUB_APP_PRIVATE_KEY: { scope: 'org-1', name: 'gh-app-key' } } },
      },
    });

    const stored = registry.get('github');
    expect(stored.transport.credentials?.env?.GITHUB_APP_PRIVATE_KEY).toEqual({
      scope: 'org-1',
      name: 'gh-app-key',
    });
    // The registry was never given any plaintext, and resolution happens only in the connector.
    expect(JSON.stringify(registry.list())).not.toMatch(/-----BEGIN|secret|token/i);
  });
});
