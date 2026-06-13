/**
 * App sessions (HELIX-142). After the IdP verifies who you are, Helix issues its
 * **own** short-lived session token (signed with a server secret) and checks that
 * on subsequent requests — so the request path never depends on the IdP being
 * reachable, and session lifetime/claims are ours to control. Standard "exchange
 * the ID token for an app session" pattern.
 */
import { JwtError, signJwt, verifyJwt } from './jwt';
import type { AuthPrincipal } from './oidc';

/** Default session lifetime: 1 hour. */
export const DEFAULT_SESSION_TTL_SECONDS = 3600;

/** A freshly minted session. */
export interface IssuedSession {
  token: string;
  /** Expiry, seconds since epoch. */
  expiresAt: number;
}

/** Raised when a session token is missing, malformed, forged, or expired. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionServiceOptions {
  /** Secret used to sign/verify session tokens (distinct from the IdP secret). */
  secret: string;
  /** Token lifetime in seconds (default {@link DEFAULT_SESSION_TTL_SECONDS}). */
  ttlSeconds?: number;
  /** `iss` stamped on issued sessions and required on verify (default `helix`). */
  issuer?: string;
}

/** Issues and verifies Helix app-session tokens carrying an {@link AuthPrincipal}. */
export class SessionService {
  private readonly secret: string;
  private readonly ttl: number;
  private readonly issuer: string;

  constructor(options: SessionServiceOptions) {
    if (!options.secret) throw new SessionError('a session secret is required');
    this.secret = options.secret;
    this.ttl = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.issuer = options.issuer ?? 'helix';
  }

  /** Issue a session for an authenticated principal. */
  issue(principal: AuthPrincipal, now?: number): IssuedSession {
    const token = signJwt(
      {
        iss: this.issuer,
        sub: principal.userId,
        email: principal.email,
        name: principal.name,
        org: principal.orgId,
        roles: principal.roles,
      },
      this.secret,
      { expiresInSeconds: this.ttl, now },
    );
    const issuedAt = now ?? Math.floor(Date.now() / 1000);
    return { token, expiresAt: issuedAt + this.ttl };
  }

  /** Verify a session token and reconstruct its principal, or throw {@link SessionError}. */
  verify(token: string, now?: number): AuthPrincipal {
    let payload;
    try {
      payload = verifyJwt(token, this.secret, { now });
    } catch (err) {
      throw new SessionError(err instanceof JwtError ? `invalid session: ${err.message}` : 'invalid session');
    }
    if (payload.iss !== this.issuer) throw new SessionError('unexpected session issuer');
    if (typeof payload.sub !== 'string') throw new SessionError('session missing subject');
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      orgId: typeof payload.org === 'string' ? payload.org : undefined,
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
    };
  }
}
