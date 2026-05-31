import type { Embedder } from './embeddings';
import type { VectorStore } from './vector-store';

/** Source attribution for a retrieved chunk, so the caller can cite it. */
export interface Citation {
  id: string;
  namespace: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalHit {
  id: string;
  content: string;
  namespace: string;
  /** Blended rank score (semanticWeight·semantic + (1−semanticWeight)·keyword). */
  score: number;
  /** Cosine similarity from the vector store, clamped to [0, 1]. */
  semanticScore: number;
  /** Fraction of query terms present in the content, in [0, 1]. */
  keywordScore: number;
  citation: Citation;
  metadata?: Record<string, unknown>;
}

export interface RetrievalResult {
  query: string;
  hits: RetrievalHit[];
}

export interface RetrievalOptions {
  /** Final number of hits to return. Default 5. */
  topK?: number;
  namespace?: string;
  orgId?: string | null;
  /** Semantic candidates to pull before re-ranking. Default `max(topK*4, 10)`. */
  candidatePool?: number;
  /** Weight on semantic vs keyword score, 0..1. Default 0.5. */
  semanticWeight?: number;
}

const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Fraction of distinct query terms that appear in the content (query-term recall). */
export function keywordScore(query: string, content: string): number {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return 0;
  const contentTerms = new Set(tokenize(content));
  let hits = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) hits++;
  return hits / queryTerms.size;
}

/**
 * Hybrid retriever (HELIX-64): pulls a semantic candidate pool from the vector
 * store, re-scores each candidate by blending cosine similarity with keyword
 * (query-term) overlap, and returns the top-k with citations. Combining both
 * beats either alone — semantics catches paraphrase, keywords catch exact terms
 * the embedder may miss.
 */
export class Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly defaults: Partial<RetrievalOptions> = {},
  ) {}

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const opts = { ...this.defaults, ...options };
    const topK = opts.topK ?? 5;
    const semanticWeight = clamp01(opts.semanticWeight ?? 0.5);
    const candidatePool = Math.max(opts.candidatePool ?? topK * 4, topK, 10);

    const [embedding] = await this.embedder.embed([query]);
    const candidates = await this.store.query(embedding, {
      topK: candidatePool,
      namespace: opts.namespace,
      orgId: opts.orgId,
    });

    const hits: RetrievalHit[] = candidates.map((c) => {
      const semanticScore = clamp01(c.score);
      const keyword = keywordScore(query, c.content);
      return {
        id: c.id,
        content: c.content,
        namespace: c.namespace,
        score: semanticWeight * semanticScore + (1 - semanticWeight) * keyword,
        semanticScore,
        keywordScore: keyword,
        citation: { id: c.id, namespace: c.namespace, content: c.content, metadata: c.metadata },
        metadata: c.metadata,
      };
    });

    hits.sort((a, b) => b.score - a.score);
    return { query, hits: hits.slice(0, topK) };
  }
}
