/**
 * Just-in-time credential injection for MCP servers (HELIX-91).
 *
 * Tool servers often need a credential — an API key, the GitHub App private key.
 * The rule here: the server config holds only a *reference* to the secret, and
 * the real value is resolved from the vault (`@helix/secrets`) **at the execution
 * boundary** — the moment we open the connection — then handed straight to the
 * transport (a stdio child process's env, or an HTTP request header). The
 * resolved secret is never persisted in the registry and never reaches the model
 * (the tool catalog surfaces only tool names + schemas), so it can't leak through
 * agent state or tool arguments.
 */
import type { SecretRef, SecretsManager } from '@helix/secrets';

/** Secret references attached to a transport, resolved at connect time (never stored resolved). */
export interface TransportCredentials {
  /** env var name → vault secret ref (for stdio servers). */
  env?: Record<string, SecretRef>;
  /** header name → vault secret ref (for http servers). */
  headers?: Record<string, SecretRef>;
}

/** The resolved plaintext form — transient: used to build the transport, then dropped. */
export interface ResolvedTransportSecrets {
  env: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * Resolve every secret ref to its plaintext from the vault, at call time. Any
 * missing secret propagates the vault's error (e.g. `SecretNotFoundError`) so we
 * **fail closed** — never connect a server without a credential it requires.
 */
export async function resolveTransportCredentials(
  credentials: TransportCredentials | undefined,
  secrets: SecretsManager,
): Promise<ResolvedTransportSecrets> {
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const [name, ref] of Object.entries(credentials?.env ?? {})) {
    env[name] = (await secrets.getSecret(ref)).expose();
  }
  for (const [name, ref] of Object.entries(credentials?.headers ?? {})) {
    headers[name] = (await secrets.getSecret(ref)).expose();
  }
  return { env, headers };
}
