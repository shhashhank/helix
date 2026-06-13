import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { EncryptedSecretStore, InMemorySecretRecordRepository, LocalKms } from '@helix/secrets';
import { AuthModule } from '../auth/auth.module';
import { GithubIntegrationController } from './github-integration.controller';
import { GithubIntegrationService } from './github-integration.service';
import { InMemoryPendingInstallStore } from './pending-install.store';
import { GITHUB_APP_CONFIG, PENDING_INSTALL_STORE, SECRETS_MANAGER } from './integration.tokens';

/** A 32-byte AES master key for the local KMS, from config or an ephemeral dev key. */
function localKms(): LocalKms {
  const fromEnv = process.env.SECRETS_MASTER_KEY;
  // Dev/test: an ephemeral per-process key. Real deployments set SECRETS_MASTER_KEY
  // (or back the vault with AWS KMS — the deferred binding, DEFERRED.md #2).
  return fromEnv ? LocalKms.fromBase64(fromEnv) : new LocalKms(randomBytes(32));
}

/**
 * GitHub onboarding (HELIX-148). Wires the connect flow over the **encrypted secret
 * vault** (`@helix/secrets`), the auth guard, and the in-memory pending-install +
 * secret repositories (durable stores / AWS KMS are the deferred bindings).
 */
@Module({
  imports: [AuthModule],
  controllers: [GithubIntegrationController],
  providers: [
    GithubIntegrationService,
    { provide: PENDING_INSTALL_STORE, useClass: InMemoryPendingInstallStore },
    { provide: GITHUB_APP_CONFIG, useFactory: () => ({ appSlug: process.env.GITHUB_APP_SLUG ?? 'helix-dev' }) },
    { provide: SECRETS_MANAGER, useFactory: () => new EncryptedSecretStore(localKms(), new InMemorySecretRecordRepository()) },
  ],
})
export class IntegrationModule {}
