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
