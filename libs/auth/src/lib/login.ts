/**
 * The sign-in exchange (HELIX-142): verify the IdP's OIDC ID token and, on success,
 * mint a Helix app session. Pure composition of {@link OidcVerifier} +
 * {@link SessionService} so the HTTP layer stays a thin wrapper.
 */
import { type AuthPrincipal, type OidcVerifier, principalFromClaims } from './oidc';
import type { IssuedSession, SessionService } from './session';

export interface LoginResult {
  session: IssuedSession;
  principal: AuthPrincipal;
}

/** Exchange a verified OIDC ID token for a Helix session + principal. */
export async function authenticateWithIdToken(
  verifier: OidcVerifier,
  sessions: SessionService,
  idToken: string,
): Promise<LoginResult> {
  const claims = await verifier.verify(idToken);
  const principal = principalFromClaims(claims);
  return { session: sessions.issue(principal), principal };
}
