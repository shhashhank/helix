/** DI tokens for the auth seam (HELIX-142) — so tests can inject known keys. */
export const OIDC_VERIFIER = Symbol('OIDC_VERIFIER');
export const SESSION_SERVICE = Symbol('SESSION_SERVICE');
/** The OIDC config (shared by the verifier and the dev-login mint endpoint, HELIX-176). */
export const OIDC_CONFIG = Symbol('OIDC_CONFIG');

/** Secret + issuer + audience for the (stand-in) OIDC verifier. */
export interface OidcConfig {
  secret: string;
  issuer: string;
  audience: string;
}
