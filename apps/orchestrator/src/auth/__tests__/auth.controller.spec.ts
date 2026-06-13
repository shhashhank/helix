import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SessionService, StaticKeyOidcVerifier, signJwt } from '@helix/auth';
import { AuthController } from '../auth.controller';
import { AuthGuard } from '../auth.guard';
import { RolesGuard } from '../roles.guard';
import { OIDC_VERIFIER, SESSION_SERVICE } from '../auth.tokens';

const IDP_SECRET = 'test-idp-secret';
const ISSUER = 'https://test-idp/';
const AUDIENCE = 'helix';
const SESSION_SECRET = 'test-session-secret';

const idToken = (claims: Record<string, unknown>) =>
  signJwt({ iss: ISSUER, aud: AUDIENCE, ...claims }, IDP_SECRET, { expiresInSeconds: 300 });

describe('AuthController (sign-in + session)', () => {
  let app: INestApplication;
  const sessions = new SessionService({ secret: SESSION_SECRET });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: SESSION_SERVICE, useValue: sessions },
        { provide: OIDC_VERIFIER, useValue: new StaticKeyOidcVerifier({ secret: IDP_SECRET, issuer: ISSUER, audience: AUDIENCE }) },
        AuthGuard,
        RolesGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/session exchanges a valid ID token for a session + principal', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/session')
      .send({ idToken: idToken({ sub: 'user-1', email: 'a@b.com', org: 'acme', roles: ['member'] }) })
      .expect(201);

    expect(res.body.principal).toEqual({ userId: 'user-1', email: 'a@b.com', name: undefined, orgId: 'acme', roles: ['member'] });
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // The issued token is a valid Helix session.
    expect(sessions.verify(res.body.token).userId).toBe('user-1');
  });

  it('POST /auth/session rejects a bad ID token with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/session')
      .send({ idToken: signJwt({ iss: 'https://evil/', aud: AUDIENCE, sub: 'u' }, IDP_SECRET, { expiresInSeconds: 300 }) })
      .expect(401);
  });

  it('GET /auth/me returns the principal for a valid session', async () => {
    const { token } = sessions.issue({ userId: 'user-7', email: 'x@y.z', orgId: 'acme', roles: ['admin'] });
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ userId: 'user-7', email: 'x@y.z', name: undefined, orgId: 'acme', roles: ['admin'] });
  });

  it('GET /auth/me is 401 without a token and with a garbage token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });

  describe('GET /auth/admin/ping (RBAC enforcement)', () => {
    const ping = (roles: string[]) => {
      const { token } = sessions.issue({ userId: 'u', roles });
      return request(app.getHttpServer()).get('/auth/admin/ping').set('Authorization', `Bearer ${token}`);
    };

    it('allows an admin (200)', async () => {
      const res = await ping(['admin']).expect(200);
      expect(res.body).toEqual({ ok: true, principal: { userId: 'u', name: undefined, email: undefined, orgId: undefined, roles: ['admin'] } });
    });

    it('allows a higher role via the hierarchy — owner satisfies admin (200)', async () => {
      await ping(['owner']).expect(200);
    });

    it('forbids a lesser role with 403', async () => {
      await ping(['member']).expect(403);
      await ping([]).expect(403);
    });

    it('is 401 without a session (AuthGuard runs first)', async () => {
      await request(app.getHttpServer()).get('/auth/admin/ping').expect(401);
    });
  });
});
