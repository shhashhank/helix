import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for the sign-in exchange: the OIDC ID token from the identity provider. */
export class CreateSessionDto {
  @ApiProperty({ description: 'The OIDC ID token (JWT) issued by the identity provider' })
  idToken!: string;
}

/** Body for the **dev-only** sign-in: mint + exchange a session for the given identity. */
export class DevLoginDto {
  @ApiProperty({ description: 'Email of the dev user to sign in as' })
  email!: string;
  @ApiProperty({ description: 'Org/tenant id to assert' })
  org!: string;
  @ApiPropertyOptional({ type: [String], description: 'Roles to assert (default: ["admin"])' })
  roles?: string[];
}

/** The authenticated principal carried in a Helix session. */
export class AuthPrincipalDto {
  @ApiProperty({ description: 'Stable user id (OIDC sub)' }) userId!: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ description: 'Org/tenant id asserted at sign-in' }) orgId?: string;
  @ApiProperty({ type: [String], description: 'Roles asserted at sign-in (enforced in HELIX-144)' })
  roles!: string[];
}

/** Returned by the sign-in exchange: a Helix app-session token + the principal. */
export class SessionResponseDto {
  @ApiProperty({ description: 'Helix session token (send as `Authorization: Bearer <token>`)' })
  token!: string;
  @ApiProperty({ description: 'Session expiry, seconds since epoch' }) expiresAt!: number;
  @ApiProperty({ type: AuthPrincipalDto }) principal!: AuthPrincipalDto;
}
