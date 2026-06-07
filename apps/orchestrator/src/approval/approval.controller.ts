import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApprovalRequest, InboxItem } from '@helix/approvals';
import { ApprovalService } from './approval.service';
import {
  ApprovalRequestDto,
  CancelApprovalDto,
  EscalateDueDto,
  InboxItemDto,
  OpenApprovalDto,
  SubmitDecisionDto,
} from './dto/approval.dto';

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly service: ApprovalService) {}

  @Post()
  @ApiOperation({ summary: 'Open an approval request gating a run' })
  @ApiCreatedResponse({ type: ApprovalRequestDto })
  open(@Body() body: OpenApprovalDto): Promise<ApprovalRequest> {
    return this.service.open({
      workflowId: body.workflowId,
      requirement: {
        approverRoles: body.requirement.approverRoles,
        minApprovals: body.requirement.minApprovals,
        slaMinutes: body.requirement.slaMinutes,
        escalateTo: body.requirement.escalateTo ?? [],
      },
      action: body.action,
      requestedBy: body.requestedBy,
      reason: body.reason,
    });
  }

  @Post('escalate-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sweep: escalate pending requests nearing their SLA to backup approvers' })
  @ApiOkResponse({ type: ApprovalRequestDto, isArray: true })
  escalateDue(@Body() body: EscalateDueDto): Promise<ApprovalRequest[]> {
    return this.service.escalateDue(body.beforeExpiryMinutes);
  }

  @Get()
  @ApiOperation({ summary: 'List approval requests (filter by run / status)' })
  @ApiQuery({ name: 'workflowId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: ApprovalRequestDto, isArray: true })
  list(
    @Query('workflowId') workflowId?: string,
    @Query('status') status?: ApprovalRequest['status'],
  ): Promise<ApprovalRequest[]> {
    return this.service.list({ workflowId, status });
  }

  @Get('inbox')
  @ApiOperation({ summary: "An approver's inbox: pending requests with progress + SLA, most-urgent first" })
  @ApiQuery({ name: 'role', required: false, description: 'Only requests this role may approve' })
  @ApiOkResponse({ type: InboxItemDto, isArray: true })
  inbox(@Query('role') role?: string): Promise<InboxItem[]> {
    return this.service.inbox(role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single approval request' })
  @ApiOkResponse({ type: ApprovalRequestDto })
  get(@Param('id') id: string): Promise<ApprovalRequest> {
    return this.service.get(id);
  }

  @Post(':id/decisions')
  @ApiOperation({ summary: "Submit an approver's decision; resumes the run once the gate resolves" })
  @ApiCreatedResponse({ type: ApprovalRequestDto })
  decide(@Param('id') id: string, @Body() body: SubmitDecisionDto): Promise<ApprovalRequest> {
    return this.service.decide(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending approval request' })
  @ApiOkResponse({ type: ApprovalRequestDto })
  cancel(@Param('id') id: string, @Body() body: CancelApprovalDto): Promise<ApprovalRequest> {
    return this.service.cancel(id, body.reason);
  }
}
