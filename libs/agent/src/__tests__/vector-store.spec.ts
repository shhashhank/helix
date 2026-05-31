import { HashingEmbedder, cosineSimilarity } from '../lib/embeddings';
import { InMemoryVectorStore, embedAndUpsert } from '../lib/vector-store';

describe('HashingEmbedder', () => {
  const embedder = new HashingEmbedder(64);

  it('produces fixed-dimension, deterministic, L2-normalized vectors', async () => {
    const [a, b] = await embedder.embed(['the cat sat', 'the cat sat']);
    expect(a).toHaveLength(64);
    expect(a).toEqual(b); // deterministic
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6); // normalized
  });

  it('scores texts sharing tokens higher than unrelated ones', async () => {
    // Bag-of-words: pick content tokens with no shared stopwords between pairs.
    const [doc, related, unrelated] = await embedder.embed([
      'cat sat mat',
      'cat mat cushion',
      'dog park run',
    ]);
    expect(cosineSimilarity(doc, related)).toBeGreaterThan(cosineSimilarity(doc, unrelated));
  });

  it('returns a zero-safe vector for empty text', async () => {
    const [v] = await embedder.embed(['']);
    expect(v).toHaveLength(64);
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe('InMemoryVectorStore', () => {
  const embedder = new HashingEmbedder(64);

  it('returns nearest matches ranked by cosine similarity', async () => {
    const store = new InMemoryVectorStore();
    await embedAndUpsert(store, embedder, [
      { id: '11111111-1111-4111-8111-111111111111', content: 'the cat sat on the mat', namespace: 'notes' },
      { id: '22222222-2222-4222-8222-222222222222', content: 'dogs run in the park', namespace: 'notes' },
    ]);

    const [q] = await embedder.embed(['cat mat']);
    const matches = await store.query(q, { topK: 2 });

    expect(matches).toHaveLength(2);
    expect(matches[0].content).toBe('the cat sat on the mat');
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });

  it('respects topK', async () => {
    const store = new InMemoryVectorStore();
    await embedAndUpsert(store, embedder, [
      { id: 'a', content: 'one', namespace: 'n' },
      { id: 'b', content: 'two', namespace: 'n' },
      { id: 'c', content: 'three', namespace: 'n' },
    ] as never);
    const [q] = await embedder.embed(['one']);
    expect(await store.query(q, { topK: 1 })).toHaveLength(1);
  });

  it('filters by namespace and org', async () => {
    const store = new InMemoryVectorStore();
    await embedAndUpsert(store, embedder, [
      { id: 'x', content: 'shared token alpha', namespace: 'A', orgId: 'org1' },
      { id: 'y', content: 'shared token alpha', namespace: 'B', orgId: 'org1' },
      { id: 'z', content: 'shared token alpha', namespace: 'A', orgId: 'org2' },
    ]);
    const [q] = await embedder.embed(['shared token alpha']);

    const inA = await store.query(q, { namespace: 'A' });
    expect(inA.map((m) => m.id).sort()).toEqual(['x', 'z']);

    const inAorg1 = await store.query(q, { namespace: 'A', orgId: 'org1' });
    expect(inAorg1.map((m) => m.id)).toEqual(['x']);
  });

  it('upsert overwrites by id', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([{ id: 'a', embedding: [1, 0], content: 'v1', namespace: 'n' }]);
    await store.upsert([{ id: 'a', embedding: [1, 0], content: 'v2', namespace: 'n' }]);
    const matches = await store.query([1, 0]);
    expect(matches).toHaveLength(1);
    expect(matches[0].content).toBe('v2');
  });
});
