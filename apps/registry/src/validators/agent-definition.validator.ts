import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { Injectable } from '@nestjs/common';
// JSON imported at build time — webpack/Jest both resolve this; no runtime fs reads.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import agentDefinitionSchema from '../../../../schemas/agent-definition/v1/agent-definition.schema.json';

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export class AgentDefinitionValidationError extends Error {
  constructor(public readonly errors: ErrorObject[]) {
    super(
      `agent definition failed schema validation: ${errors
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ')}`,
    );
    this.name = 'AgentDefinitionValidationError';
  }
}

@Injectable()
export class AgentDefinitionValidator {
  private readonly validateFn: ValidateFunction;

  constructor() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    this.validateFn = ajv.compile(agentDefinitionSchema);
  }

  validate(input: unknown): ValidationResult {
    const valid = this.validateFn(input);
    return {
      valid: valid as boolean,
      errors: (this.validateFn.errors ?? []) as ErrorObject[],
    };
  }

  assertValid(input: unknown): void {
    const { valid, errors } = this.validate(input);
    if (!valid) throw new AgentDefinitionValidationError(errors);
  }
}
