import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../../auth/auth-context';
import { RunDetail } from '../run-detail';

const res = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const sse = (frames: string[]) => {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < frames.length ? { done: false, value: encoder.encode(frames[i++]) } : { done: true, value: undefined }),
      }),
    },
  };
};

const path = (input: string): string => new URL(input, 'http://x').pathname;
const realFetch = global.fetch;
afterEach(() => {
  (global as { fetch: unknown }).fetch = realFetch;
  jest.restoreAllMocks();
});

describe('RunDetail', () => {
  it('shows the run status, live steps, and artifacts', async () => {
    const progress = {
      steps: { plan: { id: 'plan', ran: true, status: 'success' } },
      completed: ['plan'],
      skipped: [],
      levels: [['plan'], ['code']],
      done: false,
    };
    (global as { fetch: unknown }).fetch = jest.fn(async (input: string) => {
      const p = path(input);
      if (p.endsWith('/run')) return res({ workflowId: 'w', runId: 'r', status: 'RUNNING' });
      if (p.endsWith('/artifacts')) return res({ pullRequest: { url: 'https://gh/pr/1', title: 'PR #1' }, tests: { passed: 3, failed: 0, coverage: 88 }, changeSet: { filesChanged: 4, additions: 50, deletions: 3 } });
      if (p.endsWith('/stream')) return sse([`data: ${JSON.stringify(progress)}\n\n`]);
      throw new Error(`unexpected ${p}`);
    });

    render(
      <MemoryRouter initialEntries={['/requests/r1']}>
        <AuthProvider>
          <Routes>
            <Route path="/requests/:id" element={<RunDetail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // run status badge
    expect(await screen.findByText('RUNNING')).toBeTruthy();
    // live steps: plan (succeeded) + code (pending, from the levels)
    expect(await screen.findByText('plan')).toBeTruthy();
    expect(screen.getByText('code')).toBeTruthy();
    expect(screen.getByText('success')).toBeTruthy();
    // artifacts
    expect(await screen.findByText('PR #1')).toBeTruthy();
    expect(screen.getByText(/3 passed, 0 failed/)).toBeTruthy();
    expect(screen.getByText(/4 files changed \(\+50 −3\)/)).toBeTruthy();
  });
});
