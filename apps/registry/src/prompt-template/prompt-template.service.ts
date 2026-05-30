import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { AgentDefinitionPayload } from '../agent-definition/dto/agent-definition.types';
import { PromptTemplateError } from './prompt-template.error';

/** The `systemPrompt` block of an agent definition (HELIX-50 schema). */
export type SystemPromptSpec = AgentDefinitionPayload['systemPrompt'];
export type TemplateVariableSpec = NonNullable<SystemPromptSpec['variables']>[number];

/** Caller-supplied values keyed by variable name, plus any extra injected context. */
export type PromptContext = Record<string, unknown>;

export interface RenderOptions {
  /**
   * Reusable template fragments registered before rendering, usable via
   * `{{> name}}`. Keyed by partial name.
   */
  partials?: Record<string, string>;
}

// Schema defaults are NOT materialized onto stored payloads (the AJV validator
// runs without `useDefaults`), so we apply them here to match the contract.
const DEFAULT_ENGINE: NonNullable<SystemPromptSpec['templateEngine']> = 'mustache';

@Injectable()
export class PromptTemplateService {
  /**
   * Render an agent's system prompt against a context.
   *
   * - `plain` engine returns the template verbatim (no interpolation).
   * - `mustache` / `handlebars` are both rendered by the Handlebars engine
   *   (a documented superset of Mustache) with HTML escaping disabled, since
   *   prompts are plain text not markup.
   *
   * Declared variables are validated first: required-but-absent throws,
   * absent-with-default is filled, and provided values are type-checked.
   * Undeclared context keys are passed through to support context injection.
   */
  render(spec: SystemPromptSpec, context: PromptContext = {}, options: RenderOptions = {}): string {
    const engine = spec.templateEngine ?? DEFAULT_ENGINE;
    if (engine === 'plain') return spec.template;

    const resolved = this.resolveVariables(spec.variables ?? [], context);

    const hb = Handlebars.create();
    for (const [name, source] of Object.entries(options.partials ?? {})) {
      hb.registerPartial(name, source);
    }

    let compiled: HandlebarsTemplateDelegate;
    try {
      compiled = hb.compile(spec.template, { noEscape: true, strict: false });
    } catch (err) {
      throw new PromptTemplateError(`failed to compile template: ${(err as Error).message}`);
    }

    try {
      return compiled(resolved);
    } catch (err) {
      throw new PromptTemplateError(`failed to render template: ${(err as Error).message}`);
    }
  }

  private resolveVariables(
    variables: TemplateVariableSpec[],
    context: PromptContext,
  ): PromptContext {
    // Start from the caller context so undeclared keys flow through (injection).
    const out: PromptContext = { ...context };

    for (const v of variables) {
      const provided =
        Object.prototype.hasOwnProperty.call(context, v.name) && context[v.name] !== undefined;

      if (!provided) {
        if (v.default !== undefined) {
          out[v.name] = v.default;
          continue;
        }
        // `required` defaults to true per the schema.
        if (v.required !== false) {
          throw new PromptTemplateError(`missing required variable "${v.name}"`, v.name);
        }
        continue; // optional, no default → renders as empty
      }

      this.assertType(v, context[v.name]);
    }

    return out;
  }

  private assertType(v: TemplateVariableSpec, value: unknown): void {
    const ok =
      v.type === 'array'
        ? Array.isArray(value)
        : v.type === 'object'
          ? typeof value === 'object' && value !== null && !Array.isArray(value)
          : v.type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === v.type; // 'string' | 'boolean'

    if (!ok) {
      const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
      throw new PromptTemplateError(
        `variable "${v.name}" expected type ${v.type} but got ${actual}`,
        v.name,
      );
    }
  }
}
