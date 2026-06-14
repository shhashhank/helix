import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../../auth/auth-context';
import { Dashboard } from '../dashboard';

const res = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'Status',
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const path = (input: string): string => new URL(input, 'http://x').pathname;
const realFetch = global.fetch;
afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  localStorage.clear();
  jest.restoreAllMocks();
});

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/requests/:id" element={<div>run page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('Dashboard', () => {
  it('lists requests with their run status', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async (input: string) => {
      if (path(input) === '/api/requests/overview') {
        return res([{ request: { id: 'r1', title: 'Existing API', createdAt: '2026-06-14T00:00:00.000Z' }, run: { status: 'RUNNING' } }]);
      }
      throw new Error(`unexpected ${path(input)}`);
    });

    renderDashboard();

    expect(await screen.findByText('Existing API')).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
  });

  it('submits a new request and navigates to its run', async () => {
    const fetchMock = jest.fn(async (input: string, _init?: RequestInit) => {
      if (path(input) === '/api/requests/overview') return res([]);
      if (path(input) === '/api/requests') return res({ id: 'req-1' });
      throw new Error(`unexpected ${path(input)}`);
    });
    (global as { fetch: unknown }).fetch = fetchMock;

    renderDashboard();
    await screen.findByText('No requests yet — submit one above.');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New API' } });
    fireEvent.change(screen.getByLabelText('What to build'), { target: { value: 'build it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('run page')).toBeTruthy();
    const post = fetchMock.mock.calls.find((c) => path(String(c[0])) === '/api/requests' && c[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: 'New API', prompt: 'build it' });
  });
});
