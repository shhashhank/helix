import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowRunModule } from '../workflow-run/workflow-run.module';

@Module({
  imports: [WorkflowRunModule, ApprovalModule, AuthModule],
})
export class AppModule {}
