import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { TokenUsageRollupService } from '../token-usage-rollup.service';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

interface RowOpts {
  orgId?: string | null;
  runId?: string;
  model?: string;
  input?: number;
  output?: number;
  cost?: number | null;
  createdAt?: string;
}

describe('TokenUsageRollupService — integration (testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: TokenUsageRollupService;

  const insert = (o: RowOpts) =>
    prisma.tokenUsage.create({
      data: {
        orgId: o.orgId ?? null,
        runId: o.runId ?? null,
        provider: 'anthropic',
        model: o.model ?? 'claude-opus-4-8',
        inputTokens: o.input ?? 0,
        outputTokens: o.output ?? 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: o.cost === undefined ? new Prisma.Decimal('0.01') : o.cost === null ? null : new Prisma.Decimal(o.cost),
        ...(o.createdAt ? { createdAt: new Date(o.createdAt) } : {}),
      },
    });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const url = container.getConnectionUri();
    process.env.REGISTRY_DATABASE_URL = url;
    execSync(`npx prisma migrate deploy --schema ${SCHEMA_PATH}`, {
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: 'inherit',
    });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new TokenUsageRollupService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.tokenUsage.deleteMany({});
  });

  it('rolls up totals for a run', async () => {
    await insert({ runId: 'run1', input: 100, output: 50, cost: 0.02 });
    await insert({ runId: 'run1', input: 200, output: 10, cost: 0.03 });
    await insert({ runId: 'other', input: 999, output: 999, cost: 1 });

    const r = await service.byRun('run1');
    expect(r.calls).toBe(2);
    expect(r.inputTokens).toBe(300);
    expect(r.outputTokens).toBe(60);
    expect(r.totalTokens).toBe(360);
    expect(r.costUsd).toBeCloseTo(0.05, 6);
  });

  it('rolls up totals for an org, ignoring null costs', async () => {
    await insert({ orgId: 'org1', input: 10, output: 5, cost: 0.01 });
    await insert({ orgId: 'org1', input: 20, output: 5, cost: null }); // unpriced model
    await insert({ orgId: 'org2', input: 100, output: 100, cost: 9 });

    const r = await service.byOrg('org1');
    expect(r.calls).toBe(2);
    expect(r.inputTokens).toBe(30);
    expect(r.costUsd).toBeCloseTo(0.01, 6); // null ignored
  });

  it('applies a time range to org rollups', async () => {
    await insert({ orgId: 'org1', input: 10, cost: 0.01, createdAt: '2026-01-01T12:00:00Z' });
    await insert({ orgId: 'org1', input: 20, cost: 0.02, createdAt: '2026-01-05T12:00:00Z' });

    const r = await service.byOrg('org1', { from: new Date('2026-01-03T00:00:00Z') });
    expect(r.calls).toBe(1);
    expect(r.inputTokens).toBe(20);
  });

  it('produces per-day rollups ordered oldest-first', async () => {
    await insert({ orgId: 'org1', input: 10, cost: 0.01, createdAt: '2026-01-01T08:00:00Z' });
    await insert({ orgId: 'org1', input: 5, cost: 0.005, createdAt: '2026-01-01T20:00:00Z' });
    await insert({ orgId: 'org1', input: 30, cost: 0.03, createdAt: '2026-01-02T09:00:00Z' });

    const days = await service.byOrgDaily('org1');
    expect(days.map((d) => d.day)).toEqual(['2026-01-01', '2026-01-02']);
    expect(days[0]).toMatchObject({ calls: 2, inputTokens: 15 });
    expect(days[0].costUsd).toBeCloseTo(0.015, 6);
    expect(days[1]).toMatchObject({ calls: 1, inputTokens: 30 });
  });

  it('handles the shared (null-org) namespace in daily rollups', async () => {
    await insert({ orgId: null, input: 7, cost: 0.007, createdAt: '2026-02-01T10:00:00Z' });
    const days = await service.byOrgDaily(null);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ day: '2026-02-01', calls: 1, inputTokens: 7 });
  });
});
