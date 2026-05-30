import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AgentDefinition } from '@prisma/client';
import request from 'supertest';
import {
  AgentDefinitionValidationError,
} from '../../validators/agent-definition.validator';
import { AgentDefinitionController } from '../agent-definition.controller';
import { AgentDefinitionService } from '../agent-definition.service';
import { ValidationExceptionFilter } from '../validation-exception.filter';

const fakeRow = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  id: 'row-id',
  orgId: null,
  role: 'planning',
  version: 1,
  name: 'Planning Agent',
  description: null,
  systemPrompt: { template: 'p' } as object,
  modelPolicy: { tier: 'opus' } as object,
  tools: [] as object,
  guardrails: {} as object,
  outputSchema: null,
  metadata: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  ...overrides,
});

const body = {
  schemaVersion: '1.0.0',
  name: 'Planning Agent',
  role: 'planning',
  version: '1.0.0',
  systemPrompt: { template: 'plan it' },
  modelPolicy: { tier: 'opus' },
  tools: [],
  guardrails: {},
};

describe('AgentDefinitionController', () => {
  let app: INestApplication;
  let service: jest.Mocked<AgentDefinitionService>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      update: jest.fn(),
      findById: jest.fn(),
      findLatest: jest.fn(),
      findAll: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<AgentDefinitionService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentDefinitionController],
      providers: [
        { provide: AgentDefinitionService, useValue: service },
        { provide: APP_FILTER, useClass: ValidationExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /agents creates and returns 201, passing org header through', async () => {
    service.create.mockResolvedValue(fakeRow({ orgId: 'org-7' }));

    const res = await request(app.getHttpServer())
      .post('/agents')
      .set('x-org-id', 'org-7')
      .send(body)
      .expect(201);

    expect(res.body.role).toBe('planning');
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-7', payload: expect.objectContaining({ role: 'planning' }) }),
    );
  });

  it('POST /agents with no org header uses the null namespace', async () => {
    service.create.mockResolvedValue(fakeRow());
    await request(app.getHttpServer()).post('/agents').send(body).expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ orgId: null }));
  });

  it('maps AgentDefinitionValidationError to 400 with structured errors', async () => {
    service.create.mockRejectedValue(
      new AgentDefinitionValidationError([
        { instancePath: '/role', message: 'must be equal to one of the allowed values', params: {} } as never,
      ]),
    );

    const res = await request(app.getHttpServer()).post('/agents').send(body).expect(400);
    expect(res.body.message).toMatch(/schema validation/);
    expect(res.body.validationErrors[0]).toMatchObject({ path: '/role' });
  });

  it('GET /agents parses list query flags', async () => {
    service.findAll.mockResolvedValue([fakeRow()]);

    await request(app.getHttpServer())
      .get('/agents?role=planning&includeAllVersions=true&skip=5&take=10')
      .expect(200);

    expect(service.findAll).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ role: 'planning', includeAllVersions: true, skip: 5, take: 10 }),
    );
  });

  it('GET /agents/latest resolves before /agents/:id and forwards role', async () => {
    service.findLatest.mockResolvedValue(fakeRow({ version: 3 }));

    const res = await request(app.getHttpServer())
      .get('/agents/latest?role=planning')
      .expect(200);

    expect(res.body.version).toBe(3);
    expect(service.findLatest).toHaveBeenCalledWith(null, 'planning');
    expect(service.findById).not.toHaveBeenCalled();
  });

  it('GET /agents/:id forwards id and includeDeleted', async () => {
    service.findById.mockResolvedValue(fakeRow({ id: 'abc' }));

    await request(app.getHttpServer()).get('/agents/abc?includeDeleted=true').expect(200);
    expect(service.findById).toHaveBeenCalledWith('abc', true);
  });

  it('GET /agents/:id surfaces NotFoundException as 404', async () => {
    service.findById.mockRejectedValue(new NotFoundException('nope'));
    await request(app.getHttpServer()).get('/agents/missing').expect(404);
  });

  it('PUT /agents/:id updates', async () => {
    service.update.mockResolvedValue(fakeRow({ version: 2 }));

    const res = await request(app.getHttpServer()).put('/agents/row-id').send(body).expect(200);
    expect(res.body.version).toBe(2);
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-id', payload: expect.objectContaining({ role: 'planning' }) }),
    );
  });

  it('DELETE /agents/:id soft-deletes and returns 200', async () => {
    service.softDelete.mockResolvedValue(fakeRow({ deletedAt: new Date() }));

    const res = await request(app.getHttpServer()).delete('/agents/row-id').expect(200);
    expect(res.body.deletedAt).not.toBeNull();
    expect(service.softDelete).toHaveBeenCalledWith('row-id');
  });
});
