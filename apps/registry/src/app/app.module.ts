import { Module } from '@nestjs/common';
import { AgentDefinitionModule } from '../agent-definition/agent-definition.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, AgentDefinitionModule],
})
export class AppModule {}
