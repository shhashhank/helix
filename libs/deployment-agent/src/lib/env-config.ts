/**
 * Env/config + secrets wiring (HELIX-127): assemble a deploy's runtime environment
 * from two sources — plain (non-sensitive) config that's safe to inline, and
 * secret-backed env vars that must be *referenced*, never inlined.
 *
 * `resolveDeployEnv` turns a {@link DeployConfig} into the inputs `synthesizeCdkApp`
 * expects: a plain `environment` map plus a `secrets` map of env var → Secrets
 * Manager id (so the synthesized IaC carries references, never secret values).
 * `checkDeploySecrets` is a pre-flight against the real `@helix/secrets` vault that
 * confirms every referenced secret exists *without exposing any value* — keeping to
 * the platform rule that secret material never reaches logs, models, or artifacts.
 *
 * Imports from `@helix/secrets` are type-only, so this stays runtime-decoupled from
 * the vault (the missing-secret case is detected by the error's `name`).
 */
import type { SecretRef, SecretsManager } from '@helix/secrets';
import type { DeploySpec } from './cdk';

/** Binds a container/function env var to a secret held in the vault. */
export interface SecretEnvBinding {
  /** The environment variable the app reads, e.g. `DATABASE_URL`. */
  envVar: string;
  /** The vault secret backing it (org/tenant scope + name). */
  ref: SecretRef;
  /**
   * The AWS Secrets Manager id/ARN the *deployed* stack references at runtime.
   * Defaults to `<scope>/<name>`. The secret value is never read into the IaC.
   */
  secretId?: string;
}

export interface DeployConfig {
  /** Plain, non-sensitive env vars — safe to inline into the container/function. */
  env?: Record<string, string>;
  /** Secret-backed env vars — referenced via Secrets Manager, never inlined. */
  secrets?: SecretEnvBinding[];
}

/** The Secrets Manager id a binding resolves to (explicit `secretId`, else `<scope>/<name>`). */
export function secretIdFor(binding: SecretEnvBinding): string {
  return binding.secretId ?? `${binding.ref.scope}/${binding.ref.name}`;
}

export interface ResolvedDeployEnv {
  /** Plain env vars to inline into the container/function environment. */
  environment: Record<string, string>;
  /** env var → Secrets Manager id/ARN to reference (never the secret value). */
  secrets: Record<string, string>;
}

/**
 * Split a {@link DeployConfig} into the plain `environment` and the `secrets`
 * reference map, rejecting any env var claimed by both a plain value and a secret
 * (or by two secrets). No secret value is read here.
 */
export function resolveDeployEnv(config: DeployConfig): ResolvedDeployEnv {
  const environment = { ...(config.env ?? {}) };
  const secrets: Record<string, string> = {};

  for (const binding of config.secrets ?? []) {
    if (binding.envVar in environment) {
      throw new Error(`Env var ${binding.envVar} is set as both a plain value and a secret`);
    }
    if (binding.envVar in secrets) {
      throw new Error(`Duplicate secret env var: ${binding.envVar}`);
    }
    secrets[binding.envVar] = secretIdFor(binding);
  }

  return { environment, secrets };
}

/** Apply a config to a deploy spec, producing a spec ready for `synthesizeCdkApp`. */
export function withDeployConfig(
  spec: Omit<DeploySpec, 'env' | 'secrets'>,
  config: DeployConfig,
): DeploySpec {
  const resolved = resolveDeployEnv(config);
  return { ...spec, env: resolved.environment, secrets: resolved.secrets };
}

export interface SecretCheckResult {
  ok: boolean;
  /** Referenced secrets that aren't present in the vault. */
  missing: SecretRef[];
}

/**
 * Pre-flight: confirm every secret the config references actually exists in the
 * vault, so a deploy fails fast rather than at runtime. Values are fetched into a
 * redaction-safe `SecretValue` and dropped — nothing is exposed or returned.
 */
export async function checkDeploySecrets(
  vault: SecretsManager,
  config: DeployConfig,
): Promise<SecretCheckResult> {
  const missing: SecretRef[] = [];

  for (const binding of config.secrets ?? []) {
    try {
      await vault.getSecret(binding.ref);
    } catch (err) {
      // `SecretNotFoundError` is identified by name to keep this import type-only.
      if (err instanceof Error && err.name === 'SecretNotFoundError') {
        missing.push(binding.ref);
      } else {
        throw err;
      }
    }
  }

  return { ok: missing.length === 0, missing };
}
