/**
 * GitHub App authentication (HELIX-89).
 *
 * The GitHub MCP server must act as a GitHub App, not as a user PAT, so that
 * every call is made with a **short-lived, repo-scoped installation token**
 * rather than a long-lived secret. The flow is two hops:
 *
 *   1. Mint a JSON Web Token (JWT) signed with the App's RSA private key. This
 *      proves "I am App <appId>" and is valid for at most 10 minutes.
 *   2. Exchange that App JWT for an *installation access token* — scoped to one
 *      installation (and optionally a subset of its repos), valid ~1 hour.
 *
 * `GitHubAppTokenProvider` owns step 2's caching/refresh so callers just ask for
 * a token and always get a live one. The private key never leaves this process
 * and the token never has to be persisted — satisfying the MCP epic's
 * "secrets never reach the model" constraint.
 *
 * No third-party dependency: the JWT is signed with Node's built-in `crypto`
 * (RS256), and the token exchange is a single `fetch` POST.
 */
import { createSign } from 'node:crypto';

/** GitHub App identity: numeric App ID + its PEM-encoded RSA private key. */
export interface GitHubAppCredentials {
  /** The App ID from the GitHub App settings page. */
  appId: string | number;
  /** PEM-encoded RSA private key (the `.pem` GitHub generated for the App). */
  privateKey: string;
}

/** A minted installation access token and when it stops being valid. */
export interface InstallationToken {
  token: string;
  /** Epoch milliseconds at which the token expires. */
  expiresAtMs: number;
}

/**
 * Performs the App-JWT → installation-token exchange (the network hop). Injected
 * so the provider is unit-testable offline; {@link fetchInstallationTokenExchanger}
 * is the real GitHub-API implementation.
 */
export type InstallationTokenExchanger = (args: {
  appJwt: string;
  installationId: string | number;
  /** Optional least-privilege repo scope (names only, e.g. `['helix']`). */
  repositories?: string[];
}) => Promise<InstallationToken>;

const base64url = (input: string | Buffer): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64url');

/**
 * Mint a short-lived GitHub App JWT (RS256), per GitHub's spec:
 * `iat` backdated 60s for clock skew, `exp` ≤ 10 min, `iss` = App ID.
 */
export function createAppJwt(creds: GitHubAppCredentials, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000) - 60; // backdate to tolerate clock drift
  const exp = iat + 9 * 60; // 9 min — comfortably under GitHub's 10 min ceiling
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp, iss: String(creds.appId) }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(creds.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

/** Options for {@link GitHubAppTokenProvider}. */
export interface GitHubAppTokenProviderOptions {
  credentials: GitHubAppCredentials;
  /** The installation to mint tokens for (an App can be installed many places). */
  installationId: string | number;
  /** Restrict the token to these repos (least privilege). Omit for all repos. */
  repositories?: string[];
  /** The JWT→token exchange. Defaults to the real GitHub-API call. */
  exchange?: InstallationTokenExchanger;
  /** Clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Refresh this many ms before actual expiry (default 60s). */
  refreshSkewMs?: number;
}

/**
 * Hands out a live installation access token, minting one on first use and
 * caching it until it is about to expire. Concurrent callers during a refresh
 * share the same in-flight request rather than minting duplicates.
 */
export class GitHubAppTokenProvider {
  private cached?: InstallationToken;
  private inFlight?: Promise<InstallationToken>;
  private readonly exchange: InstallationTokenExchanger;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;

  constructor(private readonly options: GitHubAppTokenProviderOptions) {
    this.exchange = options.exchange ?? fetchInstallationTokenExchanger();
    this.now = options.now ?? (() => Date.now());
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
  }

  /** Return a valid installation token string, refreshing transparently. */
  async getToken(): Promise<string> {
    return (await this.getInstallationToken()).token;
  }

  /** Like {@link getToken} but also exposes the expiry. */
  async getInstallationToken(): Promise<InstallationToken> {
    if (this.cached && this.cached.expiresAtMs - this.refreshSkewMs > this.now()) {
      return this.cached;
    }
    // Coalesce concurrent refreshes into a single exchange.
    if (!this.inFlight) {
      this.inFlight = this.refresh().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async refresh(): Promise<InstallationToken> {
    const appJwt = createAppJwt(this.options.credentials, this.now());
    const token = await this.exchange({
      appJwt,
      installationId: this.options.installationId,
      repositories: this.options.repositories,
    });
    this.cached = token;
    return token;
  }
}

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * The production {@link InstallationTokenExchanger}: POSTs the App JWT to
 * `/app/installations/{id}/access_tokens` and returns the installation token.
 * Uses the global `fetch` (Node 18+); no SDK needed.
 */
export function fetchInstallationTokenExchanger(
  apiBase: string = GITHUB_API_BASE,
): InstallationTokenExchanger {
  return async ({ appJwt, installationId, repositories }) => {
    const res = await fetch(`${apiBase}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: repositories?.length ? JSON.stringify({ repositories }) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `GitHub installation token exchange failed (${res.status} ${res.statusText})${
          detail ? `: ${detail}` : ''
        }`,
      );
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    return { token: data.token, expiresAtMs: Date.parse(data.expires_at) };
  };
}

/**
 * Read GitHub App credentials from the environment, the way the runnable stdio
 * entrypoint sources them. The private key may be supplied either inline
 * (`GITHUB_APP_PRIVATE_KEY`, with `\n` escapes allowed) or, preferably, as the
 * raw multi-line PEM. Throws a clear error if a required value is missing so the
 * server fails fast instead of making unauthenticated calls.
 */
export function appTokenProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppTokenProvider {
  const appId = required(env, 'GITHUB_APP_ID');
  const installationId = required(env, 'GITHUB_APP_INSTALLATION_ID');
  const privateKey = required(env, 'GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  const repositories = env.GITHUB_APP_REPOSITORIES?.split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return new GitHubAppTokenProvider({
    credentials: { appId, privateKey },
    installationId,
    repositories: repositories?.length ? repositories : undefined,
  });
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} for GitHub App auth`);
  }
  return value;
}
