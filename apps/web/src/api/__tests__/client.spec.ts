import { ApiClient, DEFAULT_API_BASE, resolveApiBase } from '../client';

/** A minimal fake of the parts of `Response` the client reads — avoids env-global fetch/Response. */
const res = (body: unknown, opts: { status?: number; json?: boolean } = {}) => {
  const status = opts.status ?? 200;
  const isJson = opts.json ?? true;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status',
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' && isJson ? 'application/json' : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
};

const realFetch = global.fetch;
const useFetch = (fn: jest.Mock) => {
  (global as { fetch: unknown }).fetch = fn;
  return fn;
};

afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  delete window.__HELIX_API_BASE__;
});

describe('ApiClient', () => {
  it('prefixes the base URL and attaches the bearer token', async () => {
    const fetchMock = useFetch(jest.fn().mockResolvedValue(res({ ok: true })));
    await new ApiClient(() => 'tok-123', 'http://api.test').get('/api/auth/me');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchMock = useFetch(jest.fn().mockResolvedValue(res({})));
    await new ApiClient(() => undefined, 'http://api.test').get('/x');
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('POSTs a JSON body and parses the JSON response', async () => {
    const fetchMock = useFetch(jest.fn().mockResolvedValue(res({ token: 'sess' })));
    const out = await new ApiClient(() => undefined, 'http://api.test').post<{ token: string }>('/api/auth/session', { idToken: 'id' });

    expect(out).toEqual({ token: 'sess' });
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ idToken: 'id' }));
  });

  it('throws an ApiError carrying the status on a non-2xx response', async () => {
    useFetch(jest.fn().mockResolvedValue(res('nope', { status: 401, json: false })));
    await expect(new ApiClient(() => undefined, 'http://api.test').get('/x')).rejects.toMatchObject({ status: 401, message: 'nope' });
  });

  it('returns undefined for a 204 No Content', async () => {
    useFetch(jest.fn().mockResolvedValue(res(undefined, { status: 204, json: false })));
    await expect(new ApiClient(() => undefined, 'http://api.test').post('/x')).resolves.toBeUndefined();
  });

  it('resolveApiBase honours the runtime override, else the default', () => {
    expect(resolveApiBase()).toBe(DEFAULT_API_BASE);
    window.__HELIX_API_BASE__ = 'https://helix.example';
    expect(resolveApiBase()).toBe('https://helix.example');
  });
});
