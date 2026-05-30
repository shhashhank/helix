import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentDefinitionValidator } from '../validators/agent-definition.validator';
import { AgentDefinitionController } from './agent-definition.controller';
import { AgentDefinitionRepository } from './agent-definition.repository';
import { AgentDefinitionService } from './agent-definition.service';
import { ValidationExceptionFilter } from './validation-exception.filter';

@Module({
  controllers: [AgentDefinitionController],
  providers: [
    AgentDefinitionRepository,
    AgentDefinitionService,
    AgentDefinitionValidator,
    { provide: APP_FILTER, useClass: ValidationExceptionFilter },
  ],
  exports: [AgentDefinitionService],
})
export class AgentDefinitionModule {}
