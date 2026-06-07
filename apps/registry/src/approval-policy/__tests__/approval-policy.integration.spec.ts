import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ApprovalPolicyRepository } from '../approval-policy.repository';
import { ApprovalPolicyService } from '../approval-policy.service';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

const policyDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'default',
  version: 1,
  rules: [
    {
      id: 'prod-deploy',
      when: { actions: ['deploy'], environments: ['prod'] },
      require: { approverRoles: ['tech-lead'], slaMinutes: 60 },
    },
  ],
  ...overrides,
});

describe('ApprovalPolicyService — integration (real Postgres via testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: ApprovalPolicyService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const url = container.getConnectionUri();
    process.env.REGISTRY_DATABASE_URL = url;

    execSync(`npx prisma migrate deploy --schema ${SCHEMA_PATH}`, {
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new ApprovalPolicyService(new ApprovalPolicyRepository(prisma as never));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.approvalPolicy.deleteMany({});
  });

  it('create + findLatest round-trip, normalizing the document version', async () => {
    const row = await service.create({ orgId: null, document: policyDoc({ version: 7 }) });
    expect(row.version).toBe(1);
    expect(row.policyId).toBe('default');
    expect((row.document as { version: number }).version).toBe(1);

    const latest = await service.findLatest(null, 'default');
    expect(latest.id).toBe(row.id);
  });

  it('rejects a duplicate policy id', async () => {
    await service.create({ orgId: null, document: policyDoc() });
    await expect(service.create({ orgId: null, document: policyDoc() })).rejects.toThrow(/already exists/);
  });

  it('update appends the next version and findLatest follows it', async () => {
    const v1 = await service.create({ orgId: null, document: policyDoc() });
    const v2 = await service.update({ id: v1.id, document: policyDoc({ version: 99 }) });

    expect(v2.version).toBe(2);
    const latest = await service.findLatest(null, 'default');
    expect(latest.version).toBe(2);
  });

  it('soft-delete hides the row from findLatest', async () => {
    const v1 = await service.create({ orgId: null, document: policyDoc() });
    await service.softDelete(v1.id);
    await expect(service.findLatest(null, 'default')).rejects.toThrow(/no active approval policy/);
  });

  it('findAll returns the latest version per policy id by default', async () => {
    const a1 = await service.create({ orgId: null, document: policyDoc({ id: 'alpha' }) });
    await service.update({ id: a1.id, document: policyDoc({ id: 'alpha' }) });
    await service.create({ orgId: null, document: policyDoc({ id: 'beta' }) });

    const all = await service.findAll(null);
    expect(all).toHaveLength(2);
    const alpha = all.find((p) => p.policyId === 'alpha');
    expect(alpha?.version).toBe(2);
  });
});
