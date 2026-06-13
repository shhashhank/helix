import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { AuthModule } from '../auth/auth.module';
import { RequestModule } from '../request/request.module';
import { WorkflowRunModule } from '../workflow-run/workflow-run.module';

@Module({
  imports: [WorkflowRunModule, ApprovalModule, AuthModule, RequestModule],
})
export class AppModule {}
