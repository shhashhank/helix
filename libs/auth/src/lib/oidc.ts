/**
 * OIDC sign-in (HELIX-142): verify an OpenID Connect **ID token** from the identity
 * provider, then map its claims to a Helix {@link AuthPrincipal}. The provider is
 * the seam: tests/dev use {@link StaticKeyOidcVerifier} (a symmetric HS256 stand-in
 * for Auth0/Cognito), while the real RS256-against-JWKS verifier is the deferred
 * binding (DEFERRED.md). Everything downstream (sessions, guards) speaks
 * `AuthPrincipal`, so swapping the verifier needs no caller changes.
 */
import { JwtError, type JwtPayload, verifyJwt } from './jwt';

/** Standard + Helix-custom claims we read off an OIDC ID token. */
export interface OidcClaims extends JwtPayload {
  sub?: string;
  email?: string;
  name?: string;
  /** Helix org/tenant the user is signing into (custom claim). */
  org?: string;
  /** Roles asserted by the IdP, if any (RBAC enforcement lands in HELIX-144). */
  roles?: string[];
}

/** The authenticated identity Helix carries through a request. */
export interface AuthPrincipal {
  /** Stable user id (OIDC `sub`). */
  userId: string;
  email?: string;
  name?: string;
  /** Org/tenant id, if the token asserted one. */
  orgId?: string;
  /** Roles asserted at sign-in (enforcement is HELIX-144). */
  roles: string[];
}

/** Map verified OIDC claims to an {@link AuthPrincipal}. */
export function principalFromClaims(claims: OidcClaims): AuthPrincipal {
  if (!claims.sub) throw new OidcError('ID token has no `sub` claim');
  return {
    userId: claims.sub,
    email: claims.email,
    name: claims.name,
    orgId: claims.org,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
  };
}

/** Raised when an ID token fails OIDC verification (signature, issuer, audience, expiry). */
export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

/** Verifies an OIDC ID token and returns its claims. The swappable IdP seam. */
export interface OidcVerifier {
  verify(idToken: string): Promise<OidcClaims>;
}

export interface StaticKeyOidcConfig {
  /** Shared HS256 secret the (stand-in) provider signs ID tokens with. */
  secret: string;
  /** Expected `iss` — rejected if the token's issuer differs. */
  issuer: string;
  /** Expected `aud` — rejected if the token's audience differs. */
  audience: string;
  /** Clock-skew tolerance for expiry, seconds (default 60). */
  clockToleranceSeconds?: number;
}

/**
 * Local/test {@link OidcVerifier}: validates an HS256-signed ID token plus the
 * `iss`/`aud` claims. Stands in for a hosted IdP so the whole sign-in → session
 * flow runs offline; the production RS256/JWKS verifier is the deferred binding.
 */
export class StaticKeyOidcVerifier implements OidcVerifier {
  constructor(private readonly config: StaticKeyOidcConfig) {}

  async verify(idToken: string): Promise<OidcClaims> {
    let claims: OidcClaims;
    try {
      claims = verifyJwt(idToken, this.config.secret, {
        clockToleranceSeconds: this.config.clockToleranceSeconds ?? 60,
      });
    } catch (err) {
      throw new OidcError(err instanceof JwtError ? `invalid ID token: ${err.message}` : 'invalid ID token');
    }
    if (claims.iss !== this.config.issuer) throw new OidcError('unexpected token issuer');
    if (claims.aud !== this.config.audience) throw new OidcError('unexpected token audience');
    return claims;
  }
}
