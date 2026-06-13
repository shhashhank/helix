import { JwtError, signJwt, verifyJwt } from '../jwt';

const SECRET = 'test-secret';

describe('signJwt / verifyJwt', () => {
  it('round-trips a payload and stamps iat', () => {
    const token = signJwt({ sub: 'user-1', org: 'acme' }, SECRET, { now: 1000 });
    const payload = verifyJwt(token, SECRET, { now: 1000 });
    expect(payload.sub).toBe('user-1');
    expect(payload.org).toBe('acme');
    expect(payload.iat).toBe(1000);
  });

  it('sets exp from expiresInSeconds and rejects once past it', () => {
    const token = signJwt({ sub: 'u' }, SECRET, { now: 1000, expiresInSeconds: 60 });
    expect(verifyJwt(token, SECRET, { now: 1059 }).sub).toBe('u'); // still valid
    expect(() => verifyJwt(token, SECRET, { now: 1061 })).toThrow(/expired/);
  });

  it('honours clock tolerance on expiry', () => {
    const token = signJwt({ sub: 'u' }, SECRET, { now: 1000, expiresInSeconds: 60 });
    expect(verifyJwt(token, SECRET, { now: 1065, clockToleranceSeconds: 10 }).sub).toBe('u');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const token = signJwt({ sub: 'user-1', roles: ['member'] }, SECRET, { now: 1000 });
    const [h, , s] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'user-1', roles: ['admin'] })).toString('base64url');
    expect(() => verifyJwt(`${h}.${forgedBody}.${s}`, SECRET, { now: 1000 })).toThrow(JwtError);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signJwt({ sub: 'u' }, 'other-secret', { now: 1000 });
    expect(() => verifyJwt(token, SECRET, { now: 1000 })).toThrow(/bad signature/);
  });

  it('rejects malformed tokens and refuses empty secrets', () => {
    expect(() => verifyJwt('not.a.jwt.token', SECRET)).toThrow(JwtError);
    expect(() => verifyJwt('onlyonepart', SECRET)).toThrow(/malformed/);
    expect(() => signJwt({}, '')).toThrow(JwtError);
  });
});
