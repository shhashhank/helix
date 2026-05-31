import { cosineSimilarity } from './embeddings';

/** A stored chunk of memory plus its embedding. */
export interface VectorRecord {
  id: string;
  embedding: number[];
  content: string;
  /** Logical collection (e.g. a project or memory type) for scoping queries. */
  namespace: string;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VectorQueryOptions {
  /** Max matches to return. Default 5. */
  topK?: number;
  /** Restrict to a namespace. */
  namespace?: string;
  /** Restrict to an org (or the shared null namespace). */
  orgId?: string | null;
}

export interface VectorMatch {
  id: string;
  /** Cosine similarity in [-1, 1]; higher is more similar. */
  score: number;
  content: string;
  namespace: string;
  metadata?: Record<string, unknown>;
}

/**
 * A similarity-search store for embeddings (HELIX-63). MVP operations: upsert
 * records and query the nearest by cosine similarity. The pgvector-backed
 * implementation lives in the registry; {@link InMemoryVectorStore} is the
 * default for tests/dev.
 */
export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(embedding: number[], options?: VectorQueryOptions): Promise<VectorMatch[]>;
}

/** In-process cosine-similarity store — exact nearest-neighbor over a Map. */
export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record);
  }

  async query(embedding: number[], options: VectorQueryOptions = {}): Promise<VectorMatch[]> {
    const topK = options.topK ?? 5;
    return [...this.records.values()]
      .filter((r) => (options.namespace === undefined || r.namespace === options.namespace))
      .filter((r) => (options.orgId === undefined || (r.orgId ?? null) === options.orgId))
      .map((r) => ({
        id: r.id,
        score: cosineSimilarity(embedding, r.embedding),
        content: r.content,
        namespace: r.namespace,
        metadata: r.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

/**
 * Embeddings pipeline: embed each item's `content` and upsert it. The thin glue
 * between an {@link Embedder} and a {@link VectorStore} (retrieval/ranking is
 * HELIX-64).
 */
export async function embedAndUpsert(
  store: VectorStore,
  embedder: { embed(texts: string[]): Promise<number[][]> },
  items: Omit<VectorRecord, 'embedding'>[],
): Promise<void> {
  if (items.length === 0) return;
  const vectors = await embedder.embed(items.map((i) => i.content));
  await store.upsert(items.map((item, i) => ({ ...item, embedding: vectors[i] })));
}
