import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { UsageRecord } from '@helix/llm';
import { PrismaUsageSink } from '../prisma-usage.sink';
import { TokenUsageRepository } from '../token-usage.repository';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

const usageRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 256,
  },
  costUsd: 0.0175,
  latencyMs: 1234,
  streamed: false,
  context: { runId: 'run_1', orgId: 'org_1', agentRole: 'planning', taskClass: 'planning' },
  at: new Date(),
  ...overrides,
});

describe('TokenUsage persistence — integration (real Postgres via testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let repo: TokenUsageRepository;
  let sink: PrismaUsageSink;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();
    process.env.REGISTRY_DATABASE_URL = url;

    execSync(`npx prisma migrate deploy --schema ${SCHEMA_PATH}`, {
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    repo = new TokenUsageRepository(prisma as never);
    sink = new PrismaUsageSink(repo);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.tokenUsage.deleteMany({});
  });

  it('PrismaUsageSink writes a UsageRecord row that reads back by run', async () => {
    await sink.record(usageRecord());

    const rows = await repo.findByRun('run_1');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      runId: 'run_1',
      orgId: 'org_1',
      agentRole: 'planning',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 256,
      latencyMs: 1234,
      streamed: false,
    });
    expect(Number(row.costUsd)).toBeCloseTo(0.0175, 6);
  });

  it('stores a null cost and nullable context fields', async () => {
    await sink.record(usageRecord({ costUsd: null, context: { runId: 'run_2' } }));

    const [row] = await repo.findByRun('run_2');
    expect(row.costUsd).toBeNull();
    expect(row.orgId).toBeNull();
    expect(row.agentRole).toBeNull();
  });

  it('findByRun returns rows oldest-first and scoped to the run', async () => {
    await sink.record(usageRecord({ context: { runId: 'run_3' } }));
    await sink.record(usageRecord({ context: { runId: 'run_3' }, streamed: true }));
    await sink.record(usageRecord({ context: { runId: 'other' } }));

    const rows = await repo.findByRun('run_3');
    expect(rows).toHaveLength(2);
    expect(rows[0].createdAt.getTime()).toBeLessThanOrEqual(rows[1].createdAt.getTime());
  });
});
