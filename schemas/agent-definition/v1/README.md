# Agent Definition Schema — v1

JSON Schema (Draft 2020-12) that defines a Helix agent declaratively: role, prompt template, allowed tools, model routing policy, and guardrails. This is the **contract** between the agent registry (HELIX-12), prompt template engine (HELIX-52), API endpoints (HELIX-53), and the agent execution runtime (HELIX-14).

## Files

| Path | Purpose |
|---|---|
| `agent-definition.schema.json` | The canonical schema. |
| `examples/planning-agent.example.json` | Planning agent fixture (opus tier, no tools, with `outputSchema`). |
| `examples/coding-agent.example.json` | Coding agent fixture (sonnet tier, GitHub + sandbox tools, approval-gated PR creation). |

## Versioning

Two distinct version concepts:

- **Schema version** (this directory's `v1/`). Bumped only on **breaking** changes to the schema document. Add new optional fields freely; require them or remove fields → `v2/`. Existing definitions reference the version they were authored against via the top-level `schemaVersion` field.
- **Definition version** (`version` field inside each agent definition). SemVer 2.0.0 for the *instance* — e.g., a new prompt iteration of the planning agent goes from `1.0.0` → `1.1.0`. The registry keeps version history (see `agent_definitions` table, `UNIQUE (org_id, role, version)`).

## Validation

```bash
npx --yes ajv-cli@5 validate \
  --spec=draft2020 \
  -s schemas/agent-definition/v1/agent-definition.schema.json \
  -d "schemas/agent-definition/v1/examples/*.json"
```

## Field reference (top-level)

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | yes | Must be `"1.0.0"`. |
| `id` | yes | UUID. Matches DB PK. |
| `name` | yes | Human label. |
| `description` | no | ≤1000 chars. |
| `role` | yes | One of `planning`, `coding`, `code_review`, `testing`, `deployment`, `custom`. |
| `version` | yes | SemVer 2.0.0 of this definition instance. |
| `systemPrompt` | yes | `{ template, templateEngine, variables[] }`. `variables[]` declare typed inputs the template expects. |
| `modelPolicy` | yes | `{ tier, primaryModel?, fallbackModels[], maxOutputTokens, temperature?, thinking?, costCeilingUsd? }`. |
| `tools` | yes | Array of `{ name, scopes[], approvalRequired }`. Empty array = no tool use. |
| `guardrails` | yes | `{ maxSteps, maxTokensPerRun, maxToolCalls, stopSequences[], disallowedPatterns[], piiRedaction, loopDetection }`. |
| `outputSchema` | no | JSON Schema fragment for the agent's structured final output (consumed by HELIX-60). |
| `metadata` | no | `{ createdBy, createdAt, tags[] }`. |

`additionalProperties: false` at every object level — unknown fields fail validation. Add new fields to the schema first, then to definitions.

## Cross-references

- DB shape: `agent_definitions` table — see `PRODUCT_PLAN.md:823-835`.
- Registry service (uses this schema for validation): HELIX-51.
- Prompt template engine (consumes `systemPrompt`): HELIX-52.
- LLM gateway router (consumes `modelPolicy.tier`): HELIX-13.
- Tool permissioning (consumes `tools[]`): HELIX-23.
- Budget/guardrail enforcement (consumes `guardrails`): HELIX-59.
- Approval-gated tool routing (consumes `tools[].approvalRequired`): HELIX-86.
- Structured output validator (consumes `outputSchema`): HELIX-60.
