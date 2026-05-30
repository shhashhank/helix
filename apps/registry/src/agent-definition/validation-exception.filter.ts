import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { AgentDefinitionValidationError } from '../validators/agent-definition.validator';

/** Minimal structural view of the HTTP response we touch (avoids an express type dep). */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Maps the AJV-backed {@link AgentDefinitionValidationError} thrown by the
 * service layer onto a 400 response. Schema validation is single-sourced in
 * the AgentDefinitionValidator (HELIX-50/51), so the HTTP layer just translates
 * its structured errors rather than re-declaring rules with class-validator.
 */
@Catch(AgentDefinitionValidationError)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: AgentDefinitionValidationError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();
    res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'agent definition failed schema validation',
      validationErrors: exception.errors.map((e) => ({
        path: e.instancePath || '/',
        message: e.message ?? 'invalid',
        params: e.params,
      })),
    });
  }
}
