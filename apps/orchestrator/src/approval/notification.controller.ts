import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InAppInbox, InAppMessage } from '@helix/notifications';
import { InAppMessageDto } from './dto/notification.dto';
import { IN_APP_INBOX } from './notification.tokens';

/** Read side of the in-app notification channel — an address's delivered feed. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(@Inject(IN_APP_INBOX) private readonly inbox: InAppInbox) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications delivered to an address' })
  @ApiQuery({ name: 'address', required: true, description: 'In-app recipient address (e.g. a user id)' })
  @ApiOkResponse({ type: InAppMessageDto, isArray: true })
  list(@Query('address') address: string): Promise<InAppMessage[]> {
    return this.inbox.list(address ?? '');
  }
}
