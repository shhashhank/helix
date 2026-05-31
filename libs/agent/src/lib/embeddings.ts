/**
 * Turns text into a fixed-length vector for similarity search (HELIX-63). The
 * real implementation will call an embeddings provider; {@link HashingEmbedder}
 * is a deterministic, dependency-free stand-in so the pipeline and vector store
 * are fully testable without an external key.
 */
export interface Embedder {
  /** Length of every vector this embedder produces. */
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a — small, fast, deterministic string hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

/**
 * Deterministic hashing embedder: bag-of-words hashed into `dimension` buckets,
 * L2-normalized. Not semantic (no stemming/synonyms), but stable and good enough
 * to exercise vector storage + cosine ranking. Texts sharing tokens score close.
 */
export class HashingEmbedder implements Embedder {
  constructor(readonly dimension = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimension).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
      vec[fnv1a(token) % this.dimension] += 1;
    }
    return l2normalize(vec);
  }
}

/** Cosine similarity of two equal-length vectors, in [-1, 1] (higher = closer). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
