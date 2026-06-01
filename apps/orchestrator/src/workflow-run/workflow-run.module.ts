import { Module } from '@nestjs/common';
import { TemporalModule } from '../temporal/temporal.module';
import { WorkflowRunController } from './workflow-run.controller';
import { WorkflowRunService } from './workflow-run.service';

@Module({
  imports: [TemporalModule],
  controllers: [WorkflowRunController],
  providers: [WorkflowRunService],
})
export class WorkflowRunModule {}
