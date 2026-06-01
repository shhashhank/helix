import { Module } from '@nestjs/common';
import { WorkflowRunModule } from '../workflow-run/workflow-run.module';

@Module({
  imports: [WorkflowRunModule],
})
export class AppModule {}
