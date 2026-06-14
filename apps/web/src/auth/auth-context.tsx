/**
 * Auth context for the web app (HELIX-175).
 *
 * Holds the Helix session token (kept in memory + `localStorage`) and the signed-in
 * principal, exposes the sign-in/sign-out primitives the sign-in screen (HELIX-176) drives,
 * and provides the shared {@link ApiClient} (wired to always send the current token). A
 * stored token is restored on first mount by loading `/api/auth/me`; an invalid one is
 * dropped. {@link RequireAuth} gates routes behind a session.
 */
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navigate } from 'react-router-dom';
import { ApiClient } from '../api/client';

export interface Principal {
  userId: string;
  org: string;
  roles: string[];
  email?: string;
}

export interface AuthContextValue {
  token?: string;
  principal?: Principal;
  isAuthenticated: boolean;
  /** True while restoring a stored session's principal on first mount. */
  loading: boolean;
  /** The shared API client (always sends the current session token). */
  api: ApiClient;
  /** Exchange a dev OIDC ID token for a Helix session, then load the principal. */
  signInWithIdToken(idToken: string): Promise<void>;
  /** Adopt an already-minted session token (e.g. a dev login), then load the principal. */
  setSession(token: string): Promise<void>;
  signOut(): void;
}

const STORAGE_KEY = 'helix.session.token';
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [token, setToken] = useState<string | undefined>(() => readStoredToken());
  const [principal, setPrincipal] = useState<Principal | undefined>();
  const [loading, setLoading] = useState<boolean>(() => !!readStoredToken());

  // The client reads the token via a ref so it always sends the current one.
  const tokenRef = useRef<string | undefined>(token);
  tokenRef.current = token;
  const api = useMemo(() => new ApiClient(() => tokenRef.current), []);

  const adoptToken = (next: string | undefined): void => {
    tokenRef.current = next;
    setToken(next);
    if (next) writeStoredToken(next);
    else clearStoredToken();
  };

  const loadPrincipal = async (): Promise<Principal> => {
    const me = await api.get<Principal>('/api/auth/me');
    setPrincipal(me);
    return me;
  };

  // Restore the principal for a stored token on first mount; drop it if invalid.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    loadPrincipal()
      .catch(() => {
        adoptToken(undefined);
        setPrincipal(undefined);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSession = async (next: string): Promise<void> => {
    adoptToken(next);
    await loadPrincipal();
  };

  const signInWithIdToken = async (idToken: string): Promise<void> => {
    const { token: sessionToken } = await api.post<{ token: string }>('/api/auth/session', { idToken });
    await setSession(sessionToken);
  };

  const signOut = (): void => {
    adoptToken(undefined);
    setPrincipal(undefined);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ token, principal, isAuthenticated: !!token, loading, api, signInWithIdToken, setSession, signOut }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, principal, loading, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Gate a route behind a session; redirect to `/sign-in` when unauthenticated. */
export function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="helix-loading">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/sign-in" replace />;
  return children;
}

function readStoredToken(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeStoredToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* storage unavailable — keep in memory only */
  }
}
function clearStoredToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
