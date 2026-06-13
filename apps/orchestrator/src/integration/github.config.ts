/** Global GitHub App settings (HELIX-148) — the same app every org installs. */
export interface GithubAppConfig {
  /** The GitHub App slug, used to build the install URL. */
  appSlug: string;
}

/**
 * The URL a user visits to **install the GitHub App** on their org (the connect
 * wizard's "Install on GitHub" link). `state` ties the eventual callback back to
 * the org that started the flow.
 */
export function installUrl(config: GithubAppConfig, state: string): string {
  return `https://github.com/apps/${config.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}
