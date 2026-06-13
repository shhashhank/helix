import { signJwt } from '../jwt';
import { authenticateWithIdToken } from '../login';
import { OidcError, principalFromClaims, StaticKeyOidcVerifier } from '../oidc';
import { SessionError, SessionService } from '../session';

const IDP_SECRET = 'idp-secret';
const ISSUER = 'https://idp.example.com/';
const AUDIENCE = 'helix';

const verifier = new StaticKeyOidcVerifier({ secret: IDP_SECRET, issuer: ISSUER, audience: AUDIENCE });

// Mint ID tokens at the real current time: the OIDC verifier checks expiry against
// Date.now() (production behavior — the IdP seam has no test clock), so tokens must
// be live now. The SessionService tests below use a fixed clock via its `now` args.
const idToken = (claims: Record<string, unknown>, now = Math.floor(Date.now() / 1000)) =>
  signJwt({ iss: ISSUER, aud: AUDIENCE, ...claims }, IDP_SECRET, { now, expiresInSeconds: 300 });

describe('StaticKeyOidcVerifier', () => {
  it('verifies a well-formed ID token and returns its claims', async () => {
    const claims = await verifier.verify(idToken({ sub: 'user-1', email: 'a@b.com', org: 'acme', roles: ['member'] }));
    expect(claims.sub).toBe('user-1');
    expect(claims.org).toBe('acme');
  });

  it('rejects a wrong issuer or audience', async () => {
    await expect(verifier.verify(idToken({ sub: 'u', iss: 'https://evil/' }))).rejects.toThrow(/issuer/);
    await expect(verifier.verify(idToken({ sub: 'u', aud: 'other-app' }))).rejects.toThrow(/audience/);
  });

  it('rejects a token signed by an untrusted key', async () => {
    const forged = signJwt({ iss: ISSUER, aud: AUDIENCE, sub: 'u' }, 'not-the-idp-secret', { now: 1000, expiresInSeconds: 300 });
    await expect(verifier.verify(forged)).rejects.toThrow(OidcError);
  });
});

describe('principalFromClaims', () => {
  it('maps claims, defaulting roles to []', () => {
    expect(principalFromClaims({ sub: 'u', email: 'e', org: 'o' })).toEqual({
      userId: 'u',
      email: 'e',
      name: undefined,
      orgId: 'o',
      roles: [],
    });
  });

  it('requires a subject', () => {
    expect(() => principalFromClaims({ email: 'e' })).toThrow(/sub/);
  });
});

describe('SessionService', () => {
  const sessions = new SessionService({ secret: 'session-secret', ttlSeconds: 3600 });

  it('issues a session that round-trips back to the principal', () => {
    const principal = { userId: 'user-1', email: 'a@b.com', orgId: 'acme', roles: ['member'] };
    const { token, expiresAt } = sessions.issue(principal, 1000);
    expect(expiresAt).toBe(4600);
    expect(sessions.verify(token, 1500)).toEqual({ ...principal, name: undefined });
  });

  it('rejects an expired session', () => {
    const { token } = sessions.issue({ userId: 'u', roles: [] }, 1000);
    expect(() => sessions.verify(token, 5000)).toThrow(SessionError);
  });

  it("rejects another issuer's token (different secret)", () => {
    const other = new SessionService({ secret: 'different-secret' });
    const { token } = other.issue({ userId: 'u', roles: [] }, 1000);
    expect(() => sessions.verify(token, 1000)).toThrow(/invalid session/);
  });
});

describe('authenticateWithIdToken (sign-in exchange)', () => {
  const sessions = new SessionService({ secret: 'session-secret' });

  it('verifies the ID token and issues a session for the principal', async () => {
    const { session, principal } = await authenticateWithIdToken(
      verifier,
      sessions,
      idToken({ sub: 'user-9', email: 'x@y.z', org: 'acme', roles: ['member'] }),
    );
    expect(principal.userId).toBe('user-9');
    expect(principal.orgId).toBe('acme');
    // The issued app session verifies independently of the IdP.
    expect(sessions.verify(session.token).userId).toBe('user-9');
  });

  it('propagates verification failure (no session issued)', async () => {
    await expect(authenticateWithIdToken(verifier, sessions, 'garbage.token.here')).rejects.toThrow(OidcError);
  });
});
