import { Module } from '@nestjs/common';
import { SessionService, StaticKeyOidcVerifier } from '@helix/auth';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OIDC_VERIFIER, SESSION_SERVICE } from './auth.tokens';

// Dev-only fallbacks so the service runs locally without an IdP. In any real
// deployment these MUST come from the environment / secrets vault — the static
// HS256 verifier is itself the local stand-in for Auth0/Cognito (DEFERRED.md).
const DEV_SESSION_SECRET = 'dev-insecure-session-secret';
const DEV_OIDC_SECRET = 'dev-insecure-oidc-secret';
const DEV_OIDC_ISSUER = 'https://dev-idp.helix.local/';
const DEV_OIDC_AUDIENCE = 'helix';

/**
 * Wires the auth seam (HELIX-142): a {@link SessionService} and an
 * {@link StaticKeyOidcVerifier} built from env, plus the sign-in endpoints and the
 * {@link AuthGuard}. Swapping in the real RS256/JWKS verifier (the deferred binding)
 * is a one-line provider change here — nothing else moves.
 */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: SESSION_SERVICE,
      useFactory: () =>
        new SessionService({
          secret: process.env.AUTH_SESSION_SECRET ?? DEV_SESSION_SECRET,
          ttlSeconds: process.env.AUTH_SESSION_TTL_SECONDS ? Number(process.env.AUTH_SESSION_TTL_SECONDS) : undefined,
        }),
    },
    {
      provide: OIDC_VERIFIER,
      useFactory: () =>
        new StaticKeyOidcVerifier({
          secret: process.env.AUTH_OIDC_SECRET ?? DEV_OIDC_SECRET,
          issuer: process.env.AUTH_OIDC_ISSUER ?? DEV_OIDC_ISSUER,
          audience: process.env.AUTH_OIDC_AUDIENCE ?? DEV_OIDC_AUDIENCE,
        }),
    },
    AuthGuard,
  ],
  exports: [SESSION_SERVICE, AuthGuard],
})
export class AuthModule {}
