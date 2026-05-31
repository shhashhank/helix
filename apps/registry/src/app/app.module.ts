import { Module } from '@nestjs/common';
import { AgentDefinitionModule } from '../agent-definition/agent-definition.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';
import { TokenUsageModule } from '../token-usage/token-usage.module';

@Module({
  imports: [PrismaModule, AgentDefinitionModule, PromptTemplateModule, TokenUsageModule],
})
export class AppModule {}
