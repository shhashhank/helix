import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Returned when starting a connect — the install URL the user visits. */
export class ConnectGithubResponseDto {
  @ApiProperty({ description: 'GitHub App install URL — send the user here' }) installUrl!: string;
  @ApiProperty({ description: 'Opaque state to present back on the callback' }) state!: string;
}

/** Body for completing a connect after the GitHub App install redirect. */
export class CompleteConnectDto {
  @ApiProperty({ description: 'installation_id from the GitHub callback' }) installationId!: string;
  @ApiProperty({ description: 'The state issued by /connect' }) state!: string;
  @ApiPropertyOptional({ description: 'The installed account login, if known' }) accountLogin?: string;
}

/** A recorded GitHub connection. */
export class GithubConnectionDto {
  @ApiProperty() installationId!: string;
  @ApiPropertyOptional() accountLogin?: string;
  @ApiProperty() connectedAt!: string;
}

/** Whether the caller org has connected GitHub. */
export class GithubConnectionStatusDto {
  @ApiProperty() connected!: boolean;
  @ApiPropertyOptional() installationId?: string;
  @ApiPropertyOptional() accountLogin?: string;
  @ApiPropertyOptional() connectedAt?: string;
}

/** Result of a connection health check (HELIX-149). */
export class VerifyResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['verified', 'not_connected', 'not_configured', 'error'] }) status!: string;
  @ApiPropertyOptional() installationId?: string;
  @ApiProperty() checkedAt!: string;
  @ApiPropertyOptional({ description: 'Token expiry (epoch ms) when access was verified' }) tokenExpiresAtMs?: number;
  @ApiPropertyOptional() error?: string;
}
