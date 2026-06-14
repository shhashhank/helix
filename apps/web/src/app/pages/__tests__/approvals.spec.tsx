import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../../auth/auth-context';
import { ApprovalInbox } from '../approvals';

const res = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
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

const item = {
  id: 'ap1',
  action: 'deploy prod',
  requestedBy: 'planner',
  reason: 'ship it',
  approverRoles: ['tech-lead'],
  approvals: 0,
  required: 1,
  remaining: 1,
  rejections: 0,
  createdAt: '2026-06-14T00:00:00.000Z',
  ageSeconds: 10,
  slaRemainingSeconds: 3000,
  rolesDecided: [],
  awaitingRoles: ['tech-lead'],
};

const renderInbox = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <ApprovalInbox />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('ApprovalInbox', () => {
  it('lists pending approvals and records a decision, then refreshes', async () => {
    localStorage.setItem('helix.session.token', 'tok');
    let decided = false;
    const fetchMock = jest.fn(async (input: string, _init?: RequestInit) => {
      const p = path(input);
      if (p === '/api/auth/me') return res({ userId: 'u1', org: 'acme', roles: ['admin'], email: 'a@acme.io' });
      if (p === '/api/approvals/inbox') return res(decided ? [] : [item]);
      if (p.endsWith('/decisions')) {
        decided = true;
        return res({ id: 'ap1', status: 'approved' });
      }
      throw new Error(`unexpected ${p}`);
    });
    (global as { fetch: unknown }).fetch = fetchMock;

    renderInbox();

    expect(await screen.findByText('deploy prod')).toBeTruthy();
    expect(screen.getByText(/0\/1 approvals/)).toBeTruthy();
    await screen.findByText('as a@acme.io'); // principal loaded

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Nothing awaiting approval. 🎉')).toBeTruthy();
    const decisionCall = fetchMock.mock.calls.find((c) => path(String(c[0])).endsWith('/decisions'));
    expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({ approver: 'a@acme.io', role: 'tech-lead', vote: 'approve' });
  });

  it('shows an empty state when nothing is pending', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => res([]));
    renderInbox();
    await waitFor(() => expect(screen.getByText('Nothing awaiting approval. 🎉')).toBeTruthy());
  });
});
