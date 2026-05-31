import { HashingEmbedder } from '../lib/embeddings';
import { VoyageEmbedder, getEmbedder } from '../lib/voyage-embedder';

/** Fake fetch returning a Voyage-shaped response (indices intentionally out of order). */
function fakeFetch(vectors: number[][], ok = true, status = 200, body = '') {
  return jest.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok,
        status,
        text: async () => body,
        json: async () => ({
          data: vectors.map((embedding, i) => ({ embedding, index: vectors.length - 1 - i })),
        }),
      }) as unknown as Response,
  );
}

describe('VoyageEmbedder', () => {
  it('posts to the Voyage API and returns vectors in input order', async () => {
    const fetchImpl = fakeFetch([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const embedder = new VoyageEmbedder({ apiKey: 'k', fetchImpl, dimension: 2 });

    const out = await embedder.embed(['a', 'b']);

    // response had indices [1,0]; embedder sorts back to input order
    expect(out).toEqual([
      [0.3, 0.4],
      [0.1, 0.2],
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init!.headers).toMatchObject({ authorization: 'Bearer k' });
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'voyage-3.5', input: ['a', 'b'] });
  });

  it('defaults to 1024 dimensions and voyage-3.5', () => {
    expect(new VoyageEmbedder({ apiKey: 'k' }).dimension).toBe(1024);
  });

  it('returns [] for empty input without calling fetch', async () => {
    const fetchImpl = fakeFetch([]);
    expect(await new VoyageEmbedder({ apiKey: 'k', fetchImpl }).embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws without an API key', async () => {
    await expect(new VoyageEmbedder({ apiKey: '' }).embed(['x'])).rejects.toThrow(/VOYAGE_API_KEY/);
  });

  it('throws on a non-OK response', async () => {
    const fetchImpl = fakeFetch([], false, 401, 'bad key');
    await expect(new VoyageEmbedder({ apiKey: 'k', fetchImpl }).embed(['x'])).rejects.toThrow(/401 bad key/);
  });
});

describe('getEmbedder', () => {
  const original = process.env.VOYAGE_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = original;
  });

  it('returns HashingEmbedder when no key is set', () => {
    delete process.env.VOYAGE_API_KEY;
    expect(getEmbedder()).toBeInstanceOf(HashingEmbedder);
  });

  it('returns VoyageEmbedder when a key is set', () => {
    process.env.VOYAGE_API_KEY = 'k';
    expect(getEmbedder()).toBeInstanceOf(VoyageEmbedder);
  });
});
