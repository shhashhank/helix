import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for the sign-in exchange: the OIDC ID token from the identity provider. */
export class CreateSessionDto {
  @ApiProperty({ description: 'The OIDC ID token (JWT) issued by the identity provider' })
  idToken!: string;
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
