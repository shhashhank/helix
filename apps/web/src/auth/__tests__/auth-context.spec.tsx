import { type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth, useAuth } from '../auth-context';

const res = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'Status',
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const routeFor = (url: string): string => new URL(url, 'http://x').pathname;

const realFetch = global.fetch;
afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  localStorage.clear();
  jest.restoreAllMocks();
});

/** Exposes the auth context through the DOM for assertions. */
function Harness(): ReactElement {
  const { isAuthenticated, principal, signInWithIdToken, signOut } = useAuth();
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'in' : 'out'}</span>
      <span data-testid="who">{principal?.email ?? '-'}</span>
      <button onClick={() => void signInWithIdToken('id-token')}>signin</button>
      <button onClick={signOut}>signout</button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('signInWithIdToken exchanges the token, loads the principal, and persists the session', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async (input: string) => {
      const path = routeFor(input);
      if (path === '/api/auth/session') return res({ token: 'sess-tok' });
      if (path === '/api/auth/me') return res({ userId: 'u1', org: 'acme', roles: ['admin'], email: 'a@acme.io' });
      throw new Error(`unexpected ${path}`);
    });

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    expect(screen.getByTestId('auth').textContent).toBe('out');

    fireEvent.click(screen.getByText('signin'));

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('in'));
    expect(screen.getByTestId('who').textContent).toBe('a@acme.io');
    expect(localStorage.getItem('helix.session.token')).toBe('sess-tok');

    fireEvent.click(screen.getByText('signout'));
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('out'));
    expect(localStorage.getItem('helix.session.token')).toBeNull();
  });

  it('restores the principal from a stored token on mount', async () => {
    localStorage.setItem('helix.session.token', 'stored-tok');
    (global as { fetch: unknown }).fetch = jest.fn(async () => res({ userId: 'u2', org: 'beta', roles: ['member'], email: 'b@beta.io' }));

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('b@beta.io'));
    expect(screen.getByTestId('auth').textContent).toBe('in');
  });

  it('drops an invalid stored token (me → 401)', async () => {
    localStorage.setItem('helix.session.token', 'bad-tok');
    (global as { fetch: unknown }).fetch = jest.fn(async () => res({ message: 'unauthorized' }, 401));

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('out'));
    expect(localStorage.getItem('helix.session.token')).toBeNull();
  });
});

describe('RequireAuth', () => {
  it('redirects to /sign-in when unauthenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <AuthProvider>
          <Routes>
            <Route path="/sign-in" element={<div>sign in page</div>} />
            <Route
              path="/secret"
              element={
                <RequireAuth>
                  <div>secret content</div>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('sign in page')).toBeTruthy();
    expect(screen.queryByText('secret content')).toBeNull();
  });
});
