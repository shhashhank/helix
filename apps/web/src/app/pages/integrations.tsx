/**
 * GitHub connect wizard (HELIX-179). Shows the org's GitHub connection and walks through
 * connecting: start the flow (get the App install URL), then complete it with the
 * installation id from GitHub's callback. Once connected you can health-check ("Test
 * connection", HELIX-170) or disconnect. No real OAuth redirect runs locally, so the
 * callback step is entered manually — the real redirect stays deferred (DEFERRED #14).
 */
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import type { ConnectGithubResponse, GithubConnectionStatus, VerifyResult } from '../../api/types';
import { StatusBadge } from '../components/status-badge';

const BASE = '/api/integrations/github';

export function Integrations(): ReactElement {
  const { api } = useAuth();
  const [status, setStatus] = useState<GithubConnectionStatus | undefined>();
  const [connectInfo, setConnectInfo] = useState<ConnectGithubResponse | undefined>();
  const [verify, setVerify] = useState<VerifyResult | undefined>();
  const [installationId, setInstallationId] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.get<GithubConnectionStatus>(BASE));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the GitHub connection');
    }
  }, [api]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const startConnect = () =>
    run(async () => {
      setConnectInfo(await api.post<ConnectGithubResponse>(`${BASE}/connect`));
    });

  const completeConnect = () =>
    run(async () => {
      await api.post(`${BASE}/callback`, { installationId, state: connectInfo?.state, accountLogin: accountLogin || undefined });
      setConnectInfo(undefined);
      setInstallationId('');
      setAccountLogin('');
      await loadStatus();
    });

  const testConnection = () =>
    run(async () => {
      setVerify(await api.post<VerifyResult>(`${BASE}/test`));
    });

  const disconnect = () =>
    run(async () => {
      await api.del(BASE);
      setVerify(undefined);
      await loadStatus();
    });

  return (
    <section className="helix-integrations">
      <h1>GitHub</h1>
      {error && <p role="alert" className="helix-error">{error}</p>}

      {status?.connected ? (
        <div className="helix-card">
          <p>
            <strong>Connected</strong>
            {status.accountLogin ? ` to ${status.accountLogin}` : ''} (installation {status.installationId})
          </p>
          {status.connectedAt && <p className="helix-muted">Connected {new Date(status.connectedAt).toLocaleString()}</p>}
          <div className="helix-approval-actions">
            <button type="button" disabled={busy} onClick={testConnection}>
              Test connection
            </button>
            <button type="button" disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          </div>
          {verify && (
            <p>
              Health check: <StatusBadge status={verify.status} />
              {verify.error ? ` — ${verify.error}` : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="helix-card">
          <p className="helix-muted">GitHub isn't connected for this org yet.</p>
          {!connectInfo ? (
            <button type="button" disabled={busy} onClick={startConnect}>
              Connect GitHub
            </button>
          ) : (
            <>
              <p>
                1. Install the Helix GitHub App:{' '}
                <a href={connectInfo.installUrl} target="_blank" rel="noreferrer">
                  open install page
                </a>
              </p>
              <p>2. Then paste the installation id from the callback:</p>
              <label>
                Installation id
                <input value={installationId} onChange={(e) => setInstallationId(e.target.value)} placeholder="12345678" />
              </label>
              <label>
                Account login (optional)
                <input value={accountLogin} onChange={(e) => setAccountLogin(e.target.value)} placeholder="acme" />
              </label>
              <button type="button" disabled={busy || !installationId} onClick={completeConnect}>
                Complete connection
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default Integrations;
