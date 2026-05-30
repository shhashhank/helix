/**
 * In-memory shape of an agent definition body, validated against
 * the HELIX-50 JSON Schema before persistence.
 * Mirrors the schema at schemas/agent-definition/v1/agent-definition.schema.json.
 * `version` is the SemVer string from the schema; storage uses an internal int.
 */
export interface AgentDefinitionPayload {
  schemaVersion: string;
  id?: string;
  name: string;
  description?: string;
  role: 'planning' | 'coding' | 'code_review' | 'testing' | 'deployment' | 'custom';
  version: string;
  systemPrompt: {
    template: string;
    templateEngine?: 'mustache' | 'handlebars' | 'plain';
    variables?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
      required?: boolean;
      default?: unknown;
    }>;
  };
  modelPolicy: {
    tier: 'opus' | 'sonnet' | 'haiku';
    primaryModel?: string;
    fallbackModels?: string[];
    maxOutputTokens?: number;
    temperature?: number;
    thinking?: { enabled?: boolean; budgetTokens?: number };
    costCeilingUsd?: number;
  };
  tools: Array<{ name: string; scopes?: string[]; approvalRequired?: boolean }>;
  guardrails: {
    maxSteps?: number;
    maxTokensPerRun?: number;
    maxToolCalls?: number;
    stopSequences?: string[];
    disallowedPatterns?: string[];
    piiRedaction?: boolean;
    loopDetection?: {
      enabled?: boolean;
      windowSize?: number;
      similarityThreshold?: number;
    };
  };
  outputSchema?: Record<string, unknown>;
  metadata?: {
    createdBy?: string;
    createdAt?: string;
    tags?: string[];
  };
}

export interface CreateAgentDefinitionInput {
  orgId: string | null;
  payload: AgentDefinitionPayload;
}

export interface UpdateAgentDefinitionInput {
  id: string;
  payload: AgentDefinitionPayload;
}
