import { Module } from '@nestjs/common';
import { TemporalModule } from '../temporal/temporal.module';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { TemporalWorkflowSignaler, WORKFLOW_SIGNALER } from './approval.signaler';
import { APPROVAL_REQUEST_STORE, InMemoryApprovalRequestStore } from './approval.store';

@Module({
  imports: [TemporalModule],
  controllers: [ApprovalController],
  providers: [
    ApprovalService,
    { provide: APPROVAL_REQUEST_STORE, useClass: InMemoryApprovalRequestStore },
    { provide: WORKFLOW_SIGNALER, useClass: TemporalWorkflowSignaler },
  ],
  exports: [ApprovalService],
})
export class ApprovalModule {}
