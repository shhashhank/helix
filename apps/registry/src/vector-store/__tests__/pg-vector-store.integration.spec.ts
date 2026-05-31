import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { VectorRecord } from '@helix/agent';
import { PgVectorStore } from '../pg-vector-store';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

/** 1024-dim one-hot vector (orthogonal vectors → cosine 0; same index → cosine 1). */
const EMBEDDING_DIM = 1024;
function oneHot(index: number): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[index] = 1;
  return v;
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('PgVectorStore — integration (pgvector via testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let store: PgVectorStore;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const url = container.getConnectionUri();
    process.env.REGISTRY_DATABASE_URL = url;

    execSync(`npx prisma migrate deploy --schema ${SCHEMA_PATH}`, {
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    store = new PgVectorStore(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM memory_embeddings');
  });

  it('ranks nearest by cosine similarity', async () => {
    const a = uuid();
    const b = uuid();
    await store.upsert([
      { id: a, embedding: oneHot(0), content: 'apples', namespace: 'notes' },
      { id: b, embedding: oneHot(1), content: 'bananas', namespace: 'notes' },
    ]);

    const matches = await store.query(oneHot(0), { topK: 2 });
    expect(matches.map((m) => m.id)).toEqual([a, b]);
    expect(matches[0].score).toBeCloseTo(1, 5); // identical direction
    expect(matches[1].score).toBeCloseTo(0, 5); // orthogonal
    expect(matches[0].content).toBe('apples');
  });

  it('respects topK', async () => {
    await store.upsert([
      { id: uuid(), embedding: oneHot(0), content: 'a', namespace: 'n' },
      { id: uuid(), embedding: oneHot(1), content: 'b', namespace: 'n' },
      { id: uuid(), embedding: oneHot(2), content: 'c', namespace: 'n' },
    ]);
    expect(await store.query(oneHot(0), { topK: 1 })).toHaveLength(1);
  });

  it('filters by namespace and org, and round-trips metadata', async () => {
    const target = uuid();
    await store.upsert([
      { id: target, embedding: oneHot(0), content: 'x', namespace: 'A', orgId: 'org1', metadata: { tag: 'keep' } },
      { id: uuid(), embedding: oneHot(0), content: 'y', namespace: 'B', orgId: 'org1' },
      { id: uuid(), embedding: oneHot(0), content: 'z', namespace: 'A', orgId: 'org2' },
    ]);

    const matches = await store.query(oneHot(0), { namespace: 'A', orgId: 'org1' });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(target);
    expect(matches[0].metadata).toEqual({ tag: 'keep' });
  });

  it('upsert overwrites an existing id', async () => {
    const id = uuid();
    await store.upsert([{ id, embedding: oneHot(0), content: 'v1', namespace: 'n' }]);
    await store.upsert([{ id, embedding: oneHot(3), content: 'v2', namespace: 'n' }]);

    const matches = await store.query(oneHot(3), { topK: 5 });
    expect(matches).toHaveLength(1);
    expect(matches[0].content).toBe('v2');
  });
});
