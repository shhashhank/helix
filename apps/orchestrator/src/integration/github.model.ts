/**
 * An org's GitHub App connection (HELIX-148). The credential is stored **encrypted
 * in the vault** (`@helix/secrets`) keyed by the org, never in plaintext — this is
 * just the in-memory shape callers see.
 */
export interface GithubConnection {
  /** The GitHub App installation id created when the org installed the app. */
  installationId: string;
  /** The GitHub account (org/user login) the app was installed on, if known. */
  accountLogin?: string;
  /** ISO 8601 time the connection was recorded. */
  connectedAt: string;
}

/** Whether an org has connected GitHub, plus the connection if so. */
export interface GithubConnectionStatus {
  connected: boolean;
  installationId?: string;
  accountLogin?: string;
  connectedAt?: string;
}
