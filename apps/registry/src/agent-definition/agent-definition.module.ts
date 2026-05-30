import { Module } from '@nestjs/common';
import { AgentDefinitionValidator } from '../validators/agent-definition.validator';
import { AgentDefinitionRepository } from './agent-definition.repository';
import { AgentDefinitionService } from './agent-definition.service';

@Module({
  providers: [AgentDefinitionRepository, AgentDefinitionService, AgentDefinitionValidator],
  exports: [AgentDefinitionService],
})
export class AgentDefinitionModule {}
