import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { EncryptedSecretStore, InMemorySecretRecordRepository, LocalKms } from '@helix/secrets';
import type { AuthPrincipal } from '@helix/auth';
import { GithubIntegrationService } from '../github-integration.service';
import { InMemoryPendingInstallStore } from '../pending-install.store';

const principal = (over: Partial<AuthPrincipal> = {}): AuthPrincipal => ({ userId: 'u1', roles: [], orgId: 'acme', ...over });

describe('GithubIntegrationService', () => {
  let repo: InMemorySecretRecordRepository;
  let pending: InMemoryPendingInstallStore;
  let service: GithubIntegrationService;

  beforeEach(() => {
    repo = new InMemorySecretRecordRepository();
    const vault = new EncryptedSecretStore(new LocalKms(randomBytes(32)), repo);
    pending = new InMemoryPendingInstallStore();
    service = new GithubIntegrationService(vault, pending, { appSlug: 'helix-test' });
  });

  it('beginConnect returns an install URL carrying the state', () => {
    const { installUrl, state } = service.beginConnect(principal());
    expect(state).toMatch(/^[0-9a-f-]{36}$/);
    expect(installUrl).toBe(`https://github.com/apps/helix-test/installations/new?state=${state}`);
  });

  it('completeConnect records the connection and status reflects it', async () => {
    expect(await service.status(principal())).toEqual({ connected: false });

    const { state } = service.beginConnect(principal());
    const conn = await service.completeConnect(principal(), { installationId: '42', state, accountLogin: 'acme-co' });
    expect(conn).toEqual({ installationId: '42', accountLogin: 'acme-co', connectedAt: expect.any(String) });

    expect(await service.status(principal())).toEqual({
      connected: true,
      installationId: '42',
      accountLogin: 'acme-co',
      connectedAt: conn.connectedAt,
    });
  });

  it('rejects an unknown or already-used state (single-use)', async () => {
    const { state } = service.beginConnect(principal());
    await service.completeConnect(principal(), { installationId: '1', state }); // consumes it
    await expect(service.completeConnect(principal(), { installationId: '1', state })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.completeConnect(principal(), { installationId: '1', state: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a state minted for a different tenant', async () => {
    const { state } = service.beginConnect(principal({ orgId: 'acme' }));
    await expect(
      service.completeConnect(principal({ orgId: 'globex' }), { installationId: '1', state }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('isolates connections per tenant and supports disconnect', async () => {
    const a = principal({ orgId: 'acme' });
    const { state } = service.beginConnect(a);
    await service.completeConnect(a, { installationId: 'acme-inst', state });

    expect((await service.status(principal({ orgId: 'globex' }))).connected).toBe(false); // another org can't see it
    expect(await service.disconnect(a)).toEqual({ disconnected: true });
    expect((await service.status(a)).connected).toBe(false);
  });

  it('stores the credential encrypted at rest (no plaintext in the record)', async () => {
    const { state } = service.beginConnect(principal());
    await service.completeConnect(principal(), { installationId: 'super-secret-inst', state });

    const record = await repo.get('org:acme', 'github.connection');
    expect(record).toBeDefined();
    expect(record!.ciphertext.toString('utf8')).not.toContain('super-secret-inst'); // ciphertext only
    expect((await service.status(principal())).installationId).toBe('super-secret-inst'); // but decrypts back
  });
});
