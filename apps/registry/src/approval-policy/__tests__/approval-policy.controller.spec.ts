import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApprovalPolicy } from '@prisma/client';
import request from 'supertest';
import { ApprovalPolicyController } from '../approval-policy.controller';
import { ApprovalPolicyService } from '../approval-policy.service';

const fakeRow = (overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  id: 'row-id',
  orgId: null,
  policyId: 'default',
  version: 1,
  document: { id: 'default', version: 1, rules: [] } as object,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

const body = {
  id: 'default',
  version: 1,
  rules: [
    {
      id: 'prod-deploy',
      when: { actions: ['deploy'], environments: ['prod'] },
      require: { approverRoles: ['tech-lead'], slaMinutes: 60 },
    },
  ],
};

describe('ApprovalPolicyController', () => {
  let app: INestApplication;
  let service: jest.Mocked<ApprovalPolicyService>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      update: jest.fn(),
      findById: jest.fn(),
      findLatest: jest.fn(),
      findAll: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<ApprovalPolicyService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ApprovalPolicyController],
      providers: [{ provide: ApprovalPolicyService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /approval-policies creates and returns 201, passing the org header through', async () => {
    service.create.mockResolvedValue(fakeRow({ orgId: 'org-7' }));

    const res = await request(app.getHttpServer())
      .post('/approval-policies')
      .set('x-org-id', 'org-7')
      .send(body)
      .expect(201);

    expect(res.body.policyId).toBe('default');
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-7', document: expect.objectContaining({ id: 'default' }) }),
    );
  });

  it('POST with no org header uses the null namespace', async () => {
    service.create.mockResolvedValue(fakeRow());
    await request(app.getHttpServer()).post('/approval-policies').send(body).expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: null }));
  });

  it('maps a validation BadRequestException to 400', async () => {
    service.create.mockRejectedValue(
      new BadRequestException({ message: 'approval policy failed schema validation', validationErrors: [] }),
    );

    const res = await request(app.getHttpServer()).post('/approval-policies').send(body).expect(400);
    expect(res.body.message).toMatch(/schema validation/);
  });

  it('GET /approval-policies parses list query flags', async () => {
    service.findAll.mockResolvedValue([fakeRow()]);

    await request(app.getHttpServer())
      .get('/approval-policies?policyId=default&includeAllVersions=true&skip=5&take=10')
      .expect(200);

    expect(service.findAll).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ policyId: 'default', includeAllVersions: true, skip: 5, take: 10 }),
    );
  });

  it('GET /approval-policies/latest resolves before /:id and forwards policyId', async () => {
    service.findLatest.mockResolvedValue(fakeRow({ version: 3 }));

    const res = await request(app.getHttpServer())
      .get('/approval-policies/latest?policyId=default')
      .expect(200);

    expect(res.body.version).toBe(3);
    expect(service.findLatest).toHaveBeenCalledWith(null, 'default');
    expect(service.findById).not.toHaveBeenCalled();
  });

  it('GET /approval-policies/:id forwards id and includeDeleted', async () => {
    service.findById.mockResolvedValue(fakeRow({ id: 'abc' }));

    await request(app.getHttpServer()).get('/approval-policies/abc?includeDeleted=true').expect(200);
    expect(service.findById).toHaveBeenCalledWith('abc', true);
  });

  it('GET /approval-policies/:id surfaces NotFoundException as 404', async () => {
    service.findById.mockRejectedValue(new NotFoundException('nope'));
    await request(app.getHttpServer()).get('/approval-policies/missing').expect(404);
  });

  it('PUT /approval-policies/:id updates', async () => {
    service.update.mockResolvedValue(fakeRow({ version: 2 }));

    const res = await request(app.getHttpServer()).put('/approval-policies/row-id').send(body).expect(200);
    expect(res.body.version).toBe(2);
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-id', document: expect.objectContaining({ id: 'default' }) }),
    );
  });

  it('DELETE /approval-policies/:id soft-deletes and returns 200', async () => {
    service.softDelete.mockResolvedValue(fakeRow({ deletedAt: new Date() }));

    const res = await request(app.getHttpServer()).delete('/approval-policies/row-id').expect(200);
    expect(res.body.deletedAt).not.toBeNull();
    expect(service.softDelete).toHaveBeenCalledWith('row-id');
  });
});
