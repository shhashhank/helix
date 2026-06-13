import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SessionService } from '@helix/auth';
import { AuthGuard } from '../../auth/auth.guard';
import { SESSION_SERVICE } from '../../auth/auth.tokens';
import { GithubIntegrationController } from '../github-integration.controller';
import { GithubIntegrationService } from '../github-integration.service';

const sessions = new SessionService({ secret: 'test-session-secret' });
const token = () => sessions.issue({ userId: 'u1', roles: [], orgId: 'acme' }).token;

describe('GithubIntegrationController', () => {
  let app: INestApplication;
  let service: jest.Mocked<GithubIntegrationService>;

  beforeEach(async () => {
    service = {
      beginConnect: jest.fn(),
      completeConnect: jest.fn(),
      status: jest.fn(),
      disconnect: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<GithubIntegrationService>;
    const moduleRef = await Test.createTestingModule({
      controllers: [GithubIntegrationController],
      providers: [
        { provide: GithubIntegrationService, useValue: service },
        { provide: SESSION_SERVICE, useValue: sessions },
        AuthGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a session on every route (401 without one)', async () => {
    await request(app.getHttpServer()).post('/integrations/github/connect').expect(401);
    await request(app.getHttpServer()).get('/integrations/github').expect(401);
  });

  it('POST /connect returns the install URL', async () => {
    service.beginConnect.mockReturnValue({ installUrl: 'https://github.com/apps/helix/installations/new?state=s1', state: 's1' });
    const res = await request(app.getHttpServer())
      .post('/integrations/github/connect')
      .set('Authorization', `Bearer ${token()}`)
      .expect(201);
    expect(res.body.state).toBe('s1');
    expect(service.beginConnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', orgId: 'acme' }));
  });

  it('POST /callback completes the connect with the principal', async () => {
    service.completeConnect.mockResolvedValue({ installationId: '42', connectedAt: '2026-06-13T00:00:00.000Z' });
    const res = await request(app.getHttpServer())
      .post('/integrations/github/callback')
      .set('Authorization', `Bearer ${token()}`)
      .send({ installationId: '42', state: 's1' })
      .expect(201);
    expect(res.body.installationId).toBe('42');
    expect(service.completeConnect).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      { installationId: '42', state: 's1' },
    );
  });

  it('GET / returns connection status; DELETE disconnects', async () => {
    service.status.mockResolvedValue({ connected: true, installationId: '42' });
    const res = await request(app.getHttpServer()).get('/integrations/github').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(res.body).toEqual({ connected: true, installationId: '42' });

    service.disconnect.mockResolvedValue({ disconnected: true });
    await request(app.getHttpServer()).delete('/integrations/github').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(service.disconnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
  });

  it('POST /test health-checks the connection (HELIX-149)', async () => {
    service.verify.mockResolvedValue({ ok: true, status: 'verified', installationId: '42', checkedAt: '2026-06-13T00:00:00.000Z' });
    const res = await request(app.getHttpServer()).post('/integrations/github/test').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(res.body).toEqual({ ok: true, status: 'verified', installationId: '42', checkedAt: '2026-06-13T00:00:00.000Z' });
    expect(service.verify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    await request(app.getHttpServer()).post('/integrations/github/test').expect(401); // no session
  });
});
