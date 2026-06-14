/**
 * Run dashboard (HELIX-177): submit a build request and see all your requests with their
 * run status. Submitting starts a run and jumps to its live detail view.
 */
import { type FormEvent, type ReactElement, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import type { BuildRequest, DashboardItem } from '../../api/types';
import { StatusBadge } from '../components/status-badge';

export function Dashboard(): ReactElement {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await api.get<DashboardItem[]>('/api/requests/overview'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const request = await api.post<BuildRequest>('/api/requests', { title, prompt });
      navigate(`/requests/${request.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
      setBusy(false);
    }
  };

  return (
    <section className="helix-dashboard">
      <h1>Run dashboard</h1>

      <form className="helix-card" onSubmit={onSubmit} aria-label="Submit a build request">
        <h2>New request</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Todo API" required />
        </label>
        <label>
          What to build
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Build me a NestJS todo API with CRUD" rows={3} required />
        </label>
        {error && <p role="alert" className="helix-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </form>

      <h2>Your requests</h2>
      {items.length === 0 ? (
        <p className="helix-muted">No requests yet — submit one above.</p>
      ) : (
        <table className="helix-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ request, run }) => (
              <tr key={request.id}>
                <td>
                  <Link to={`/requests/${request.id}`}>{request.title}</Link>
                </td>
                <td>
                  <StatusBadge status={run.status} />
                </td>
                <td className="helix-muted">{new Date(request.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default Dashboard;
