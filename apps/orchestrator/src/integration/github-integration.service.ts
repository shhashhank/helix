import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '@helix/auth';
import { type SecretRef, type SecretsManager, SecretNotFoundError } from '@helix/secrets';
import { GithubAppConfig, installUrl } from './github.config';
import { GithubConnection, GithubConnectionStatus } from './github.model';
import { PendingInstallStore } from './pending-install.store';
import { GITHUB_APP_CONFIG, PENDING_INSTALL_STORE, SECRETS_MANAGER } from './integration.tokens';

/** Vault key under which an org's GitHub connection is stored. */
const CONNECTION_SECRET = 'github.connection';

export interface CompleteConnectInput {
  installationId: string;
  /** The `state` issued by {@link GithubIntegrationService.beginConnect}. */
  state: string;
  accountLogin?: string;
}

/**
 * GitHub App connect flow (HELIX-148): start an install (hand back the install URL),
 * complete it from the callback (validating the `state`), and report / drop the
 * connection. The credential lives **encrypted in the vault** (`@helix/secrets`),
 * scoped per org — so one tenant's GitHub connection is isolated from another's and
 * never stored in plaintext. The wizard UI and the real GitHub calls are deferred.
 */
@Injectable()
export class GithubIntegrationService {
  constructor(
    @Inject(SECRETS_MANAGER) private readonly vault: SecretsManager,
    @Inject(PENDING_INSTALL_STORE) private readonly pending: PendingInstallStore,
    @Inject(GITHUB_APP_CONFIG) private readonly config: GithubAppConfig,
  ) {}

  /** Per-tenant vault scope (an org, or the user when there's no org). */
  private scopeOf(principal: AuthPrincipal): string {
    return principal.orgId ? `org:${principal.orgId}` : `user:${principal.userId}`;
  }

  private refFor(principal: AuthPrincipal): SecretRef {
    return { scope: this.scopeOf(principal), name: CONNECTION_SECRET };
  }

  /** Step 1: mint a `state`, remember who started it, and return the install URL. */
  beginConnect(principal: AuthPrincipal): { installUrl: string; state: string } {
    const state = randomUUID();
    this.pending.add(state, this.scopeOf(principal));
    return { installUrl: installUrl(this.config, state), state };
  }

  /** Step 2: the org installed the app; record the connection against the `state`'s tenant. */
  async completeConnect(principal: AuthPrincipal, input: CompleteConnectInput): Promise<GithubConnection> {
    const pending = this.pending.take(input.state);
    if (!pending || pending.scope !== this.scopeOf(principal)) {
      throw new BadRequestException('invalid or expired install state');
    }
    const connection: GithubConnection = {
      installationId: input.installationId,
      ...(input.accountLogin ? { accountLogin: input.accountLogin } : {}),
      connectedAt: new Date().toISOString(),
    };
    await this.vault.setSecret(this.refFor(principal), JSON.stringify(connection));
    return connection;
  }

  /** The caller org's GitHub connection status (reads from the vault). */
  async status(principal: AuthPrincipal): Promise<GithubConnectionStatus> {
    try {
      const secret = await this.vault.getSecret(this.refFor(principal));
      const connection = JSON.parse(secret.expose()) as GithubConnection;
      return { connected: true, ...connection };
    } catch (err) {
      if (err instanceof SecretNotFoundError) return { connected: false };
      throw err;
    }
  }

  /** Disconnect — delete the org's stored GitHub credential. */
  async disconnect(principal: AuthPrincipal): Promise<{ disconnected: boolean }> {
    return { disconnected: await this.vault.deleteSecret(this.refFor(principal)) };
  }
}
