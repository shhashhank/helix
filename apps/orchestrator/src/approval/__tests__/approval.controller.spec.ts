import { ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApprovalRequest } from '@helix/approvals';
import request from 'supertest';
import { ApprovalController } from '../approval.controller';
import { ApprovalService } from '../approval.service';

const fakeReq = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'appr-1',
  status: 'pending',
  approverRoles: ['tech-lead'],
  minApprovals: 1,
  escalateTo: [],
  action: 'deploy prod',
  subjectId: 'run-7',
  createdAt: '2026-06-08T10:00:00.000Z',
  decisions: [],
  ...overrides,
});

describe('ApprovalController', () => {
  let app: INestApplication;
  let service: jest.Mocked<ApprovalService>;

  beforeEach(async () => {
    service = {
      open: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
      inbox: jest.fn(),
      decide: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<ApprovalService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ApprovalController],
      providers: [{ provide: ApprovalService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /approvals opens a request', async () => {
    service.open.mockResolvedValue(fakeReq());
    const body = {
      workflowId: 'run-7',
      action: 'deploy prod',
      requirement: { approverRoles: ['tech-lead'], minApprovals: 1, escalateTo: [] },
    };
    const res = await request(app.getHttpServer()).post('/approvals').send(body).expect(201);

    expect(res.body.id).toBe('appr-1');
    expect(service.open).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'run-7', action: 'deploy prod' }),
    );
  });

  it('GET /approvals forwards the workflowId/status filter', async () => {
    service.list.mockResolvedValue([fakeReq()]);
    await request(app.getHttpServer()).get('/approvals?workflowId=run-7&status=pending').expect(200);
    expect(service.list).toHaveBeenCalledWith({ workflowId: 'run-7', status: 'pending' });
  });

  it('GET /approvals/inbox resolves before /:id and forwards the role', async () => {
    service.inbox.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/approvals/inbox?role=tech-lead').expect(200);
    expect(service.inbox).toHaveBeenCalledWith('tech-lead');
    expect(service.get).not.toHaveBeenCalled();
  });

  it('GET /approvals/:id returns a request, 404 when missing', async () => {
    service.get.mockResolvedValue(fakeReq({ id: 'appr-9' }));
    await request(app.getHttpServer()).get('/approvals/appr-9').expect(200);

    service.get.mockRejectedValue(new NotFoundException('nope'));
    await request(app.getHttpServer()).get('/approvals/missing').expect(404);
  });

  it('POST /approvals/:id/decisions submits a decision', async () => {
    service.decide.mockResolvedValue(fakeReq({ status: 'approved' }));
    const res = await request(app.getHttpServer())
      .post('/approvals/appr-1/decisions')
      .send({ approver: 'alice', role: 'tech-lead', vote: 'approve' })
      .expect(201);

    expect(res.body.status).toBe('approved');
    expect(service.decide).toHaveBeenCalledWith('appr-1', {
      approver: 'alice',
      role: 'tech-lead',
      vote: 'approve',
    });
  });

  it('POST /approvals/:id/decisions surfaces a state conflict as 409', async () => {
    service.decide.mockRejectedValue(new ConflictException('cannot decide a approved request'));
    await request(app.getHttpServer())
      .post('/approvals/appr-1/decisions')
      .send({ approver: 'bob', role: 'tech-lead', vote: 'approve' })
      .expect(409);
  });

  it('POST /approvals/:id/cancel cancels and returns 200', async () => {
    service.cancel.mockResolvedValue(fakeReq({ status: 'cancelled' }));
    const res = await request(app.getHttpServer())
      .post('/approvals/appr-1/cancel')
      .send({ reason: 'aborted' })
      .expect(200);

    expect(res.body.status).toBe('cancelled');
    expect(service.cancel).toHaveBeenCalledWith('appr-1', 'aborted');
  });
});
