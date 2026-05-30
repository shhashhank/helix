/**
 * Raised when a prompt template cannot be rendered: a required variable is
 * missing, a provided value has the wrong type, or the template fails to
 * compile. Carries an optional `variable` for missing/mistyped-input cases so
 * callers can surface a precise message.
 */
export class PromptTemplateError extends Error {
  constructor(
    message: string,
    public readonly variable?: string,
  ) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}
