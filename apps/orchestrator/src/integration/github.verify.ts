/**
 * GitHub connection health check (HELIX-149). Verifying *access* means proving we
 * can still act as the org's installation — i.e. mint an installation token from
 * the App key and reach the GitHub API. That's a live network hop, so it's the
 * swappable seam: the real verifier wraps `@helix/github-mcp`'s
 * `GitHubAppTokenProvider` (the deferred binding — it needs the App credentials and
 * network, which CI doesn't have), while {@link UnconfiguredGithubVerifier} is the
 * honest default when no App is configured.
 */

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
