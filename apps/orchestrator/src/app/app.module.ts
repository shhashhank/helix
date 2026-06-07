import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { WorkflowRunModule } from '../workflow-run/workflow-run.module';

@Module({
  imports: [WorkflowRunModule, ApprovalModule],
})
export class AppModule {}
