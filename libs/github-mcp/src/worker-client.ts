/**
 * Build an installation-scoped, authenticated {@link GitHubClient} for the worker
 * (HELIX-184). The delivery step (HELIX-183/186) needs a real GitHub client scoped to the
 * **run's org installation** — unlike the stdio server (HELIX-169), whose installation is
 * fixed in env, here the installation id varies per run.
 *
 * Octokit (`@octokit/rest`) is ESM-only, so it's loaded with a dynamic `import()` (kept out
 * of the module graph until the factory is actually called) — the auth wiring itself
 * ({@link authedGitHubClient}) is a plain function, so it's unit-tested without Octokit.
 * Not exported from the barrel; the worker imports it via the `@helix/github-mcp/worker-client`
 * subpath so consumers don't pull Octokit.
 */
import {
  type GitHubAppCredentials,
  GitHubAppTokenProvider,
  type InstallationTokenExchanger,
} from './app-auth';
import type { GitHubClient } from './github-client';
import { type OctokitLike, createOctokitGitHubClient } from './octokit-client';

/** The slice of an Octokit instance {@link authedGitHubClient} uses. */
export interface OctokitInstanceLike {
  hook: { before(name: 'request', fn: (options: { headers: Record<string, string> }) => unknown): void };
  rest: unknown;
}

/** Supplies a live token (e.g. a {@link GitHubAppTokenProvider}). */
export interface TokenSource {
  getToken(): Promise<string>;
}

/**
 * Wire a token-refreshing auth hook onto an Octokit instance and adapt it to a
 * {@link GitHubClient}. Before every request, the current token from `source` is set as
 * `Authorization: token <…>` — so a short-lived installation token is always fresh.
 */
export function authedGitHubClient(octokit: OctokitInstanceLike, source: TokenSource): GitHubClient {
  octokit.hook.before('request', async (options) => {
    options.headers.authorization = `token ${await source.getToken()}`;
  });
  return createOctokitGitHubClient(octokit.rest as OctokitLike);
}

export interface InstallationClientDeps {
  credentials: GitHubAppCredentials;
  /** The org's GitHub App installation to act as (per run). */
  installationId: string | number;
  /** Restrict the token to these repos (least privilege). */
  repositories?: string[];
  /** The JWT→token exchange; defaults to the real GitHub-API call. Injectable for tests. */
  exchange?: InstallationTokenExchanger;
}

/**
 * Build an installation-scoped, authenticated {@link GitHubClient}. Constructs a real
 * Octokit (dynamic import) authenticated by a {@link GitHubAppTokenProvider} for the given
 * installation.
 */
export async function createInstallationGitHubClient(deps: InstallationClientDeps): Promise<GitHubClient> {
  const provider = new GitHubAppTokenProvider({
    credentials: deps.credentials,
    installationId: deps.installationId,
    repositories: deps.repositories,
    exchange: deps.exchange,
  });
  const { Octokit } = await import('@octokit/rest');
  return authedGitHubClient(new Octokit() as unknown as OctokitInstanceLike, provider);
}

/**
 * Read the GitHub App credentials from the environment (`GITHUB_APP_ID` +
 * `GITHUB_APP_PRIVATE_KEY`, `\n` escapes allowed), or `undefined` when not configured — so
 * the worker can gate delivery off when there's no App.
 */
export function githubAppCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubAppCredentials | undefined {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !privateKey) return undefined;
  return { appId, privateKey };
}
