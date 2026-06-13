/**
 * Minimal HS256 JWT sign/verify (HELIX-142) built on `node:crypto` — no external
 * dependency, fully offline-testable. This backs the **local/dev** auth path: our
 * own app sessions and the test stand-in for an OIDC provider.
 *
 * Production OIDC verification (RS256 against an IdP's rotating JWKS — Auth0 /
 * Cognito) is the deferred binding (DEFERRED.md) and would use a vetted library
 * like `jose`; this module is intentionally limited to the symmetric HS256 case.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Raised when a token is malformed, has a bad signature, or has expired. */
export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtError';
  }
}

/** Registered + custom claims carried in a JWT payload. */
export interface JwtPayload {
  /** Issuer. */
  iss?: string;
  /** Subject (the stable user id). */
  sub?: string;
  /** Audience. */
  aud?: string;
  /** Expiry, seconds since epoch. */
  exp?: number;
  /** Issued-at, seconds since epoch. */
  iat?: number;
  [claim: string]: unknown;
}

export interface SignOptions {
  /** Lifetime in seconds; sets `exp = now + expiresInSeconds` when given. */
  expiresInSeconds?: number;
  /** Override "now" (seconds since epoch) — for deterministic tests. */
  now?: number;
}

export interface VerifyOptions {
  /** Override "now" (seconds since epoch) — for deterministic tests. */
  now?: number;
  /** Clock-skew tolerance in seconds when checking `exp` (default 0). */
  clockToleranceSeconds?: number;
}

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64url = (s: string): Buffer => Buffer.from(s, 'base64url');

const sign = (signingInput: string, secret: string): string =>
  base64url(createHmac('sha256', secret).update(signingInput).digest());

/** Sign a payload into a compact HS256 JWT. */
export function signJwt(payload: JwtPayload, secret: string, opts: SignOptions = {}): string {
  if (!secret) throw new JwtError('a signing secret is required');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    iat: now,
    ...(opts.expiresInSeconds != null ? { exp: now + opts.expiresInSeconds } : {}),
    ...payload,
  };
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(Buffer.from(JSON.stringify(full)));
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * Verify an HS256 JWT's signature and expiry, returning its payload. Throws
 * {@link JwtError} on any malformed/forged/expired token.
 */
export function verifyJwt(token: string, secret: string, opts: VerifyOptions = {}): JwtPayload {
  if (!secret) throw new JwtError('a verification secret is required');
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('malformed token');
  const [header, body, signature] = parts;

  const expected = sign(`${header}.${body}`, secret);
  const a = fromBase64url(signature);
  const b = fromBase64url(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new JwtError('bad signature');

  let payload: JwtPayload;
  try {
    const decoded = JSON.parse(fromBase64url(body).toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) throw new Error('not an object');
    payload = decoded as JwtPayload;
  } catch {
    throw new JwtError('malformed payload');
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.clockToleranceSeconds ?? 0;
  if (typeof payload.exp === 'number' && now > payload.exp + tolerance) {
    throw new JwtError('token expired');
  }
  return payload;
}
