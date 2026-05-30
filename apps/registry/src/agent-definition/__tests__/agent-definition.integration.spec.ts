import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AgentDefinitionValidationError, AgentDefinitionValidator } from '../../validators/agent-definition.validator';
import { AgentDefinitionRepository } from '../agent-definition.repository';
import { AgentDefinitionService } from '../agent-definition.service';
import type { AgentDefinitionPayload } from '../dto/agent-definition.types';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

const validPayload = (overrides: Partial<AgentDefinitionPayload> = {}): AgentDefinitionPayload => ({
  schemaVersion: '1.0.0',
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Planning Agent',
  role: 'planning',
  version: '1.0.0',
  systemPrompt: { template: 'Plan it.' },
  modelPolicy: { tier: 'opus' },
  tools: [],
  guardrails: {},
  ...overrides,
});

describe('AgentDefinitionService — integration (real Postgres via testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: AgentDefinitionService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();
    process.env.REGISTRY_DATABASE_URL = url;

    // Apply migrations
    execSync(`npx prisma migrate deploy --schema ${SCHEMA_PATH}`, {
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    const repo = new AgentDefinitionRepository(prisma as never);
    const validator = new AgentDefinitionValidator();
    service = new AgentDefinitionService(repo, validator);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.agentDefinition.deleteMany({});
  });

  it('create + findLatest round-trip', async () => {
    const row = await service.create({ orgId: null, payload: validPayload() });
    expect(row.version).toBe(1);
    expect(row.role).toBe('planning');

    const latest = await service.findLatest(null, 'planning');
    expect(latest.id).toBe(row.id);
  });

  it('update bumps version, prior version remains queryable by id', async () => {
    const v1 = await service.create({ orgId: null, payload: validPayload() });
    const v2 = await service.update({ id: v1.id, payload: validPayload({ name: 'Planning Agent v2' }) });

    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    const fetchedV1 = await service.findById(v1.id);
    expect(fetchedV1.version).toBe(1);

    const latest = await service.findLatest(null, 'planning');
    expect(latest.id).toBe(v2.id);
  });

  it('softDelete on latest version surfaces previous version as latest', async () => {
    const v1 = await service.create({ orgId: null, payload: validPayload() });
    const v2 = await service.update({ id: v1.id, payload: validPayload() });

    await service.softDelete(v2.id);

    const latest = await service.findLatest(null, 'planning');
    expect(latest.id).toBe(v1.id);
  });

  it('rejects schema-invalid payload (missing required field)', async () => {
    const bad = { ...validPayload() } as Partial<AgentDefinitionPayload>;
    delete bad.role;
    await expect(
      service.create({ orgId: null, payload: bad as AgentDefinitionPayload }),
    ).rejects.toBeInstanceOf(AgentDefinitionValidationError);
  });

  it('enforces unique (orgId, role, version) — second create for same role conflicts', async () => {
    await service.create({ orgId: null, payload: validPayload() });
    await expect(service.create({ orgId: null, payload: validPayload() })).rejects.toThrow(/already exists/);
  });

  it('isolates definitions per orgId', async () => {
    await service.create({ orgId: null, payload: validPayload() });
    const orgRow = await service.create({
      orgId: '33333333-3333-4333-8333-333333333333',
      payload: validPayload(),
    });
    expect(orgRow.version).toBe(1);
    expect(orgRow.orgId).toBe('33333333-3333-4333-8333-333333333333');
  });
});
