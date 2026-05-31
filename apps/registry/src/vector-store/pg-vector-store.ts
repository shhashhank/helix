import { Injectable } from '@nestjs/common';
// Type-only import — no runtime dependency on the agent library.
import type { VectorMatch, VectorQueryOptions, VectorRecord, VectorStore } from '@helix/agent';
import { PrismaService } from '../prisma/prisma.service';

/** Serialize a number[] to the pgvector text literal `[a,b,c]`. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

interface QueryRow {
  id: string;
  namespace: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number;
}

/**
 * pgvector-backed {@link VectorStore} (HELIX-63). Stores embeddings in the
 * `memory_embeddings` table and ranks by cosine similarity using pgvector's
 * `<=>` (cosine distance) operator. Implements the `@helix/agent` contract via a
 * type-only import; vectors are written/read with raw SQL since Prisma has no
 * native vector type.
 */
@Injectable()
export class PgVectorStore implements VectorStore {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) {
      const vector = toVectorLiteral(r.embedding);
      const metadata = r.metadata ? JSON.stringify(r.metadata) : null;
      await this.prisma.$executeRaw`
        INSERT INTO memory_embeddings (id, org_id, namespace, content, metadata, embedding)
        VALUES (${r.id}::uuid, ${r.orgId ?? null}, ${r.namespace}, ${r.content}, ${metadata}::jsonb, ${vector}::vector)
        ON CONFLICT (id) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          namespace = EXCLUDED.namespace,
          content = EXCLUDED.content,
          metadata = EXCLUDED.metadata,
          embedding = EXCLUDED.embedding`;
    }
  }

  async query(embedding: number[], options: VectorQueryOptions = {}): Promise<VectorMatch[]> {
    const vector = toVectorLiteral(embedding);
    const topK = options.topK ?? 5;
    const ns = options.namespace ?? null;
    const org = options.orgId ?? null;

    const rows = await this.prisma.$queryRaw<QueryRow[]>`
      SELECT id::text AS id, namespace, content, metadata,
             1 - (embedding <=> ${vector}::vector) AS score
      FROM memory_embeddings
      WHERE (${ns}::text IS NULL OR namespace = ${ns})
        AND (${org}::text IS NULL OR org_id = ${org})
      ORDER BY embedding <=> ${vector}::vector ASC
      LIMIT ${topK}`;

    return rows.map((r) => ({
      id: r.id,
      score: Number(r.score),
      content: r.content,
      namespace: r.namespace,
      metadata: r.metadata ?? undefined,
    }));
  }
}
