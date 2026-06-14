/**
 * Sign-in screen (HELIX-176).
 *
 * No real IdP runs locally, so the browser can't mint an OIDC token. This drives the
 * orchestrator's **dev-only** `/api/auth/dev-login` (mint + exchange for an email/org/roles)
 * to get a Helix session — the real OIDC redirect stays deferred (DEFERRED #12). Already-
 * signed-in visitors are sent to the dashboard.
 */
import { type FormEvent, type ReactElement, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';

const ROLE_OPTIONS = ['admin', 'member', 'owner'];

export function SignIn(): ReactElement {
  const { isAuthenticated, signInWithDevLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('dev@helix.local');
  const [org, setOrg] = useState('acme');
  const [role, setRole] = useState('admin');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await signInWithDevLogin({ email, org, roles: [role] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="helix-signin">
      <h1>Sign in to Helix</h1>
      <p className="helix-muted">Dev sign-in — no identity provider needed locally.</p>
      <form onSubmit={onSubmit} aria-label="Sign in">
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Organization
          <input value={org} onChange={(e) => setOrg(e.target.value)} required />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {error && <p role="alert" className="helix-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}

export default SignIn;
