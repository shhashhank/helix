import type { SecretRef, SecretValue, SecretsManager } from '@helix/secrets';
import { synthesizeCdkApp } from '../cdk';
import {
  DeployConfig,
  checkDeploySecrets,
  resolveDeployEnv,
  secretIdFor,
  withDeployConfig,
} from '../env-config';

const config: DeployConfig = {
  env: { NODE_ENV: 'production', LOG_LEVEL: 'info' },
  secrets: [
    { envVar: 'DATABASE_URL', ref: { scope: 'acme', name: 'db-url' } },
    { envVar: 'API_KEY', ref: { scope: 'acme', name: 'api-key' }, secretId: 'arn:aws:secretsmanager:eu-west-1:1:secret:api-key' },
  ],
};

describe('resolveDeployEnv / secretIdFor', () => {
  it('separates plain env from secret references, never inlining a value', () => {
    const resolved = resolveDeployEnv(config);
    expect(resolved.environment).toEqual({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    expect(resolved.secrets).toEqual({
      DATABASE_URL: 'acme/db-url', // default id = <scope>/<name>
      API_KEY: 'arn:aws:secretsmanager:eu-west-1:1:secret:api-key', // explicit secretId honoured
    });
  });

  it('defaults a secret id to <scope>/<name>', () => {
    expect(secretIdFor({ envVar: 'X', ref: { scope: 's', name: 'n' } })).toBe('s/n');
  });

  it('rejects an env var claimed by both a plain value and a secret', () => {
    expect(() =>
      resolveDeployEnv({ env: { DATABASE_URL: 'x' }, secrets: [{ envVar: 'DATABASE_URL', ref: { scope: 's', name: 'n' } }] }),
    ).toThrow(/both a plain value and a secret/);
  });

  it('rejects two secrets bound to the same env var', () => {
    expect(() =>
      resolveDeployEnv({
        secrets: [
          { envVar: 'DUP', ref: { scope: 's', name: 'a' } },
          { envVar: 'DUP', ref: { scope: 's', name: 'b' } },
        ],
      }),
    ).toThrow(/Duplicate secret env var/);
  });
});

describe('withDeployConfig → synthesizeCdkApp', () => {
  it('feeds resolved env + secret references into an ECS stack as a Secrets Manager map', () => {
    const spec = withDeployConfig(
      { appName: 'helix-demo', image: '1.dkr.ecr.eu-west-1.amazonaws.com/app:latest', kind: 'ecs', region: 'eu-west-1' },
      config,
    );
    const stack = new Map(synthesizeCdkApp(spec).map((f) => [f.path, f.content])).get('lib/helix-demo-stack.ts')!;

    expect(stack).toContain("import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'");
    expect(stack).toContain('environment: { "NODE_ENV": "production", "LOG_LEVEL": "info" }');
    expect(stack).toContain('secrets: {');
    expect(stack).toContain(
      "DATABASE_URL: ecs.Secret.fromSecretsManager(secretsmanager.Secret.fromSecretNameV2(this, 'SecretDatabaseUrl', \"acme/db-url\"))",
    );
    expect(stack).toContain(
      "API_KEY: ecs.Secret.fromSecretsManager(secretsmanager.Secret.fromSecretNameV2(this, 'SecretApiKey', \"arn:aws:secretsmanager:eu-west-1:1:secret:api-key\"))",
    );
    // the secret VALUES are never present in the synthesized IaC — only references
    expect(stack).not.toContain('expose');
  });

  it('feeds secret references into a Lambda stack via imported secrets + grantRead + ARN env', () => {
    const spec = withDeployConfig(
      { appName: 'helix-demo', image: '1.dkr.ecr.eu-west-1.amazonaws.com/app:latest', kind: 'lambda', region: 'eu-west-1' },
      config,
    );
    const stack = new Map(synthesizeCdkApp(spec).map((f) => [f.path, f.content])).get('lib/helix-demo-stack.ts')!;

    expect(stack).toContain(
      "const secretDatabaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'SecretDatabaseUrl', \"acme/db-url\");",
    );
    expect(stack).toContain('secretDatabaseUrl.grantRead(fn);');
    expect(stack).toContain('"DATABASE_URL": secretDatabaseUrl.secretArn');
    expect(stack).toContain('"NODE_ENV": "production"');
  });
});

/** Fake vault: knows a fixed set of refs; throws a SecretNotFoundError-shaped error otherwise. */
function fakeVault(known: SecretRef[]): SecretsManager {
  const has = (r: SecretRef) => known.some((k) => k.scope === r.scope && k.name === r.name);
  return {
    async getSecret(ref: SecretRef): Promise<SecretValue> {
      if (!has(ref)) {
        const err = new Error(`Secret not found: ${ref.scope}/${ref.name}`);
        err.name = 'SecretNotFoundError';
        throw err;
      }
      return { expose: () => 'redacted', length: 8 } as unknown as SecretValue;
    },
    async setSecret() {},
    async deleteSecret() {
      return true;
    },
    async listSecrets() {
      return known;
    },
  };
}

describe('checkDeploySecrets', () => {
  it('passes when every referenced secret exists in the vault', async () => {
    const vault = fakeVault([
      { scope: 'acme', name: 'db-url' },
      { scope: 'acme', name: 'api-key' },
    ]);
    const result = await checkDeploySecrets(vault, config);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('reports the missing refs (and exposes no value)', async () => {
    const vault = fakeVault([{ scope: 'acme', name: 'db-url' }]); // api-key missing
    const result = await checkDeploySecrets(vault, config);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ scope: 'acme', name: 'api-key' }]);
  });

  it('rethrows unexpected errors (not a missing-secret)', async () => {
    const vault: SecretsManager = {
      async getSecret() {
        throw new Error('kms unavailable');
      },
      async setSecret() {},
      async deleteSecret() {
        return true;
      },
      async listSecrets() {
        return [];
      },
    };
    await expect(checkDeploySecrets(vault, config)).rejects.toThrow('kms unavailable');
  });

  it('is a no-op (ok) when the config has no secrets', async () => {
    const result = await checkDeploySecrets(fakeVault([]), { env: { A: 'b' } });
    expect(result).toEqual({ ok: true, missing: [] });
  });
});
