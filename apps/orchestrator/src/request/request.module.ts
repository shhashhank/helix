import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkflowRunModule } from '../workflow-run/workflow-run.module';
import { RequestController } from './request.controller';
import { RequestService } from './request.service';
import { InMemoryRequestStore, REQUEST_STORE } from './request.store';

/**
 * Build-request submission (HELIX-145). Pulls in the run service to start workflows
 * and the auth module for the session guard; the request store is the in-memory
 * seam (durable store deferred).
 */
@Module({
  imports: [WorkflowRunModule, AuthModule],
  controllers: [RequestController],
  providers: [RequestService, { provide: REQUEST_STORE, useClass: InMemoryRequestStore }],
})
export class RequestModule {}
