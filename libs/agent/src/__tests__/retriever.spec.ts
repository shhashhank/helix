import type { Embedder } from '../lib/embeddings';
import { Retriever, keywordScore } from '../lib/retriever';
import type { VectorMatch, VectorQueryOptions, VectorStore } from '../lib/vector-store';

// Embedder stub — the retriever only forwards its output to the (stub) store.
const stubEmbedder: Embedder = { dimension: 3, async embed(texts) { return texts.map(() => [0, 0, 0]); } };

// Store stub returning preset candidates; records the query options it was called with.
function stubStore(candidates: VectorMatch[]) {
  const calls: VectorQueryOptions[] = [];
  const store: VectorStore = {
    async upsert() {},
    async query(_embedding, options = {}) {
      calls.push(options);
      return candidates;
    },
  };
  return { store, calls };
}

const match = (id: string, score: number, content: string, namespace = 'notes'): VectorMatch => ({
  id,
  score,
  content,
  namespace,
});

describe('keywordScore', () => {
  it('is the fraction of query terms present in the content', () => {
    expect(keywordScore('cat mat', 'the cat sat on the mat')).toBe(1);
    expect(keywordScore('cat dog', 'only a cat here')).toBe(0.5);
    expect(keywordScore('cat', 'dogs and birds')).toBe(0);
    expect(keywordScore('', 'anything')).toBe(0);
  });
});

describe('Retriever.retrieve', () => {
  // Doc A: high semantic, no query terms. Doc B: low semantic, all query terms.
  const candidates = [
    match('A', 0.9, 'felines lounging quietly'),
    match('B', 0.2, 'cat mat'),
  ];

  it('semanticWeight=1 ranks by semantic similarity', async () => {
    const { store } = stubStore(candidates);
    const r = await new Retriever(stubEmbedder, store).retrieve('cat mat', { semanticWeight: 1 });
    expect(r.hits.map((h) => h.id)).toEqual(['A', 'B']);
  });

  it('semanticWeight=0 ranks by keyword overlap', async () => {
    const { store } = stubStore(candidates);
    const r = await new Retriever(stubEmbedder, store).retrieve('cat mat', { semanticWeight: 0 });
    expect(r.hits.map((h) => h.id)).toEqual(['B', 'A']);
  });

  it('blends both scores at the default weight', async () => {
    const { store } = stubStore(candidates);
    const r = await new Retriever(stubEmbedder, store).retrieve('cat mat'); // weight 0.5
    const a = r.hits.find((h) => h.id === 'A')!;
    const b = r.hits.find((h) => h.id === 'B')!;
    expect(a.score).toBeCloseTo(0.5 * 0.9 + 0.5 * 0, 6); // 0.45
    expect(b.score).toBeCloseTo(0.5 * 0.2 + 0.5 * 1, 6); // 0.60
    expect(r.hits[0].id).toBe('B'); // fused winner
  });

  it('attaches a citation to every hit', async () => {
    const { store } = stubStore([match('A', 0.9, 'felines lounging', 'docs')]);
    const r = await new Retriever(stubEmbedder, store).retrieve('cats');
    expect(r.hits[0].citation).toEqual({
      id: 'A',
      namespace: 'docs',
      content: 'felines lounging',
      metadata: undefined,
    });
  });

  it('limits to topK and forwards namespace/org + a wider candidate pool to the store', async () => {
    const many = Array.from({ length: 20 }, (_, i) => match(`d${i}`, 0.5, `term${i}`));
    const { store, calls } = stubStore(many);
    const r = await new Retriever(stubEmbedder, store).retrieve('q', {
      topK: 3,
      namespace: 'A',
      orgId: 'org1',
    });
    expect(r.hits).toHaveLength(3);
    expect(calls[0]).toMatchObject({ namespace: 'A', orgId: 'org1' });
    expect(calls[0].topK).toBeGreaterThanOrEqual(10); // candidate pool ≥ topK
  });

  it('clamps a negative semantic score to 0', async () => {
    const { store } = stubStore([match('A', -0.3, 'no query terms here')]);
    const r = await new Retriever(stubEmbedder, store).retrieve('zzz', { semanticWeight: 1 });
    expect(r.hits[0].semanticScore).toBe(0);
    expect(r.hits[0].score).toBe(0);
  });
});
