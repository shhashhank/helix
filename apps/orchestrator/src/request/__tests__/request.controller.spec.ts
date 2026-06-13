import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SessionService } from '@helix/auth';
import { AuthGuard } from '../../auth/auth.guard';
import { SESSION_SERVICE } from '../../auth/auth.tokens';
import { BuildRequest } from '../request.model';
import { RequestController } from '../request.controller';
import { RequestService } from '../request.service';

const sessions = new SessionService({ secret: 'test-session-secret' });
const token = (over: Record<string, unknown> = {}) =>
  sessions.issue({ userId: 'u1', roles: [], orgId: 'acme', ...over }).token;

const fakeReq = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  id: 'req-1',
  orgId: 'acme',
  submittedBy: 'u1',
  title: 'T',
  prompt: 'p',
  status: 'submitted',
  workflowId: 'run-1',
  runId: 'rid-1',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  createdAt: '2026-06-13T00:00:00.000Z',
  ...over,
});

describe('RequestController', () => {
  let app: INestApplication;
  let service: jest.Mocked<RequestService>;

  beforeEach(async () => {
    service = { submit: jest.fn(), list: jest.fn(), get: jest.fn() } as unknown as jest.Mocked<RequestService>;
    const moduleRef = await Test.createTestingModule({
      controllers: [RequestController],
      providers: [
        { provide: RequestService, useValue: service },
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

  it('POST /requests requires a session (401 without one)', async () => {
    await request(app.getHttpServer()).post('/requests').send({ title: 'T', prompt: 'p' }).expect(401);
  });

  it('POST /requests submits with the authenticated principal', async () => {
    service.submit.mockResolvedValue(fakeReq());
    const res = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'T', prompt: 'build X' })
      .expect(201);

    expect(res.body.id).toBe('req-1');
    expect(service.submit).toHaveBeenCalledWith(
      { title: 'T', prompt: 'build X', workflow: undefined },
      expect.objectContaining({ userId: 'u1', orgId: 'acme' }),
    );
  });

  it('GET /requests lists for the caller, forwarding the mine flag', async () => {
    service.list.mockResolvedValue([fakeReq()]);
    await request(app.getHttpServer()).get('/requests?mine=true').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), true);
  });

  it('GET /requests/:id fetches one with the principal', async () => {
    service.get.mockResolvedValue(fakeReq({ id: 'req-9' }));
    const res = await request(app.getHttpServer()).get('/requests/req-9').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(res.body.id).toBe('req-9');
    expect(service.get).toHaveBeenCalledWith('req-9', expect.objectContaining({ userId: 'u1' }));
  });
});
