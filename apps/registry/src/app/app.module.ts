import { Module } from '@nestjs/common';
import { AgentDefinitionModule } from '../agent-definition/agent-definition.module';
import { ApprovalPolicyModule } from '../approval-policy/approval-policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { WorkingMemoryModule } from '../working-memory/working-memory.module';

@Module({
  imports: [
    PrismaModule,
    AgentDefinitionModule,
    ApprovalPolicyModule,
    PromptTemplateModule,
    TokenUsageModule,
    WorkingMemoryModule,
    VectorStoreModule,
  ],
})
export class AppModule {}
