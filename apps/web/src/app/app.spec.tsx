import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './app';

const res = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'Status',
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const realFetch = global.fetch;
afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('App shell', () => {
  it('redirects an unauthenticated visitor to the sign-in screen', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Sign in')).toBeTruthy();
  });

  it('renders the dashboard shell + nav when a stored session restores', async () => {
    localStorage.setItem('helix.session.token', 'tok');
    (global as { fetch: unknown }).fetch = jest.fn(async () => res({ userId: 'u1', org: 'acme', roles: ['admin'], email: 'a@acme.io' }));

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Run dashboard')).toBeTruthy();
    // the shell nav + signed-in principal are present
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/a@acme\.io · acme/)).toBeTruthy());
  });
});
