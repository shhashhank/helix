import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One delivered in-app notification (mirrors `InAppMessage`). */
export class InAppMessageDto {
  @ApiProperty() notificationId!: string;
  @ApiProperty({ description: 'Event type, e.g. approval.requested' }) type!: string;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) data?: Record<string, unknown>;
  @ApiProperty() deliveredAt!: string;
}
