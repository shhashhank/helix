import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../../auth/auth-context';
import { SignIn } from '../sign-in';

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

const renderSignIn = () =>
  render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/" element={<div>dashboard here</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('SignIn', () => {
  it('signs in via dev-login with the form values and lands on the dashboard', async () => {
    const fetchMock = jest.fn(async (input: string, _init?: RequestInit) => {
      if (path(input) === '/api/auth/dev-login') return res({ token: 'sess' });
      if (path(input) === '/api/auth/me') return res({ userId: 'dev@helix.local', org: 'acme', roles: ['admin'], email: 'dev@helix.local' });
      throw new Error(`unexpected ${path(input)}`);
    });
    (global as { fetch: unknown }).fetch = fetchMock;

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('dashboard here')).toBeTruthy();
    const devLoginCall = fetchMock.mock.calls.find((c) => path(String(c[0])) === '/api/auth/dev-login');
    const body = devLoginCall?.[1]?.body;
    expect(body).toBeDefined();
    expect(JSON.parse(String(body))).toEqual({ email: 'dev@helix.local', org: 'acme', roles: ['admin'] });
  });

  it('shows an error when dev-login is rejected', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => res({ message: 'dev login is disabled' }, 403));

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('dashboard here')).toBeNull();
  });
});
