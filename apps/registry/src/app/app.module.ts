import { Module } from '@nestjs/common';
import { AgentDefinitionModule } from '../agent-definition/agent-definition.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';

@Module({
  imports: [PrismaModule, AgentDefinitionModule, PromptTemplateModule],
})
export class AppModule {}
