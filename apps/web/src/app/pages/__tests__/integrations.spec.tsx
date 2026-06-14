import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../../auth/auth-context';
import { Integrations } from '../integrations';

const res = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const path = (input: string): string => new URL(input, 'http://x').pathname;
const BASE = '/api/integrations/github';
const realFetch = global.fetch;
afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  jest.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Integrations />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('Integrations (GitHub connect wizard)', () => {
  it('walks through connect → callback → connected', async () => {
    let connected = false;
    const fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
      const p = path(input);
      const method = init?.method ?? 'GET';
      if (p === BASE && method === 'GET') {
        return res(connected ? { connected: true, installationId: '12345678', accountLogin: 'acme', connectedAt: '2026-06-14T00:00:00.000Z' } : { connected: false });
      }
      if (p === `${BASE}/connect`) return res({ installUrl: 'https://github.com/apps/helix/installations/new', state: 'st-1' });
      if (p === `${BASE}/callback`) {
        connected = true;
        return res({ installationId: '12345678', accountLogin: 'acme', connectedAt: '2026-06-14T00:00:00.000Z' });
      }
      throw new Error(`unexpected ${method} ${p}`);
    });
    (global as { fetch: unknown }).fetch = fetchMock;

    renderPage();
    await screen.findByText(/isn't connected/);

    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByText('open install page')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Installation id'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete connection' }));

    // Reaching the connected state surfaces the Test connection / Disconnect actions.
    expect(await screen.findByRole('button', { name: 'Test connection' })).toBeTruthy();
    const callback = fetchMock.mock.calls.find((c) => path(String(c[0])) === `${BASE}/callback`);
    expect(JSON.parse(String(callback?.[1]?.body))).toEqual({ installationId: '12345678', state: 'st-1' });
  });

  it('health-checks a connected org', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async (input: string) => {
      const p = path(input);
      if (p === BASE) return res({ connected: true, installationId: '999', accountLogin: 'beta' });
      if (p === `${BASE}/test`) return res({ ok: true, status: 'verified', checkedAt: '2026-06-14T00:00:00.000Z' });
      throw new Error(`unexpected ${p}`);
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('verified')).toBeTruthy();
  });
});
