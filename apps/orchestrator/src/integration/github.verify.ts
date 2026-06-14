/**
 * GitHub connection health check (HELIX-149). Verifying *access* means proving we
 * can still act as the org's installation — i.e. mint an installation token from
 * the App key and reach the GitHub API. That's a live network hop, so it's the
 * swappable seam: the real verifier wraps `@helix/github-mcp`'s
 * `GitHubAppTokenProvider` (the deferred binding — it needs the App credentials and
 * network, which CI doesn't have), while {@link UnconfiguredGithubVerifier} is the
 * honest default when no App is configured.
 */
import {
  type GitHubAppCredentials,
  type InstallationTokenExchanger,
  createAppJwt,
  fetchInstallationTokenExchanger,
} from '@helix/github-mcp/app-auth';

/** The outcome a verifier reports for one installation. */
export interface VerifyOutcome {
  ok: boolean;
  /** `verified` (access confirmed) · `not_configured` (no GitHub App) · `error` (check failed). */
  status: 'verified' | 'not_configured' | 'error';
  /** Token expiry, epoch ms, when a token was successfully minted. */
  tokenExpiresAtMs?: number;
  error?: string;
}

/** The full health result the API returns (the service adds the request-level fields). */
export interface VerifyResult {
  ok: boolean;
  /** `verified` · `not_connected` (org hasn't connected) · `not_configured` · `error`. */
  status: 'verified' | 'not_connected' | 'not_configured' | 'error';
  installationId?: string;
  /** ISO 8601 time of the check. */
  checkedAt: string;
  /** Token expiry, epoch ms, when access was verified. */
  tokenExpiresAtMs?: number;
  error?: string;
}

/** Proves (or disproves) that a stored installation still grants access. The live seam. */
export interface GithubConnectionVerifier {
  verify(installationId: string): Promise<VerifyOutcome>;
}

/**
 * Default verifier when the platform has no GitHub App configured (dev / CI): it
 * can't mint a token, so it honestly reports `not_configured` rather than pretending
 * the connection is healthy.
 */
export class UnconfiguredGithubVerifier implements GithubConnectionVerifier {
  async verify(_installationId: string): Promise<VerifyOutcome> {
    return { ok: false, status: 'not_configured', error: 'no GitHub App configured for this deployment' };
  }
}

/** Tunables for {@link AppCredentialsGithubVerifier} (injectable for offline tests). */
export interface AppCredentialsGithubVerifierOptions {
  /** The App-JWT → installation-token exchange (default: the real GitHub-API call). */
  exchange?: InstallationTokenExchanger;
  /** Clock, injectable for tests (default `Date.now`). */
  now?: () => number;
}

/**
 * Live verifier (HELIX-170, DEFERRED #14): proves access by minting an installation token
 * for the given installation from the App credentials — a real network hop. Reuses
 * `@helix/github-mcp`'s App-JWT signing + token exchange (the private key never leaves
 * this process). `verified` on success (carrying the token expiry); any failure (bad key,
 * revoked install, network) maps to `error` rather than throwing.
 */
export class AppCredentialsGithubVerifier implements GithubConnectionVerifier {
  private readonly exchange: InstallationTokenExchanger;
  private readonly now: () => number;

  constructor(
    private readonly credentials: GitHubAppCredentials,
    options: AppCredentialsGithubVerifierOptions = {},
  ) {
    this.exchange = options.exchange ?? fetchInstallationTokenExchanger();
    this.now = options.now ?? (() => Date.now());
  }

  async verify(installationId: string): Promise<VerifyOutcome> {
    try {
      const appJwt = createAppJwt(this.credentials, this.now());
      const token = await this.exchange({ appJwt, installationId });
      return { ok: true, status: 'verified', tokenExpiresAtMs: token.expiresAtMs };
    } catch (err) {
      return { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Build the verifier from the environment: the live {@link AppCredentialsGithubVerifier}
 * when the GitHub App credentials (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`) are present,
 * else the honest {@link UnconfiguredGithubVerifier}. Mirrors `appTokenProviderFromEnv`'s
 * env shape; the installation id is supplied per call.
 */
export function githubVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): GithubConnectionVerifier {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !privateKey) return new UnconfiguredGithubVerifier();
  return new AppCredentialsGithubVerifier({ appId, privateKey });
}
