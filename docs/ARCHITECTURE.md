# Helix — architecture at a glance

What's been built so far and how the pieces connect and run in sync. Diagrams are
[Mermaid](https://mermaid.js.org/) — they render on GitHub and in VS Code's Mermaid
preview. For per-ticket detail see [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md); to run it
locally see [LOCAL_TESTING.md](LOCAL_TESTING.md).

**Legend:** solid = built & merged · dashed = planned / not yet wired.

---

## 1. System architecture

How the apps, shared libraries, and external systems fit together.

```mermaid
flowchart TB
  user([Developer · future UI])

  subgraph svc["Services — NestJS apps"]
    direction TB
    reg["Registry API · /api/agents<br/>apps/registry"]
    orc["Orchestrator API · /api/runs + SSE<br/>apps/orchestrator"]
  end

  subgraph dur["Durable execution — Temporal"]
    direction TB
    tmp[("Temporal server<br/>durable run state")]
    wkr["Workflow Worker<br/>runs steps · dev-worker"]
  end

  subgraph lib["Shared libraries — @helix/*"]
    direction TB
    wf["@helix/workflow<br/>DSL · validator · compiler · runner<br/>versioning · idempotency · Temporal glue"]
    ag["@helix/agent<br/>agent loop · guardrails<br/>memory · vector recall · tracing<br/>telemetry redaction"]
    lm["@helix/llm<br/>Anthropic provider · model router<br/>cost ceiling · retry/breaker · metering"]
    mc["@helix/mcp<br/>client · server registry · tool catalog<br/>policy · quota · approval gating<br/>JIT credential injection"]
    gh["@helix/github-mcp<br/>GitHub MCP server<br/>read/search · branch/commit · PR tools<br/>GitHub App installation-token auth"]
    sec["@helix/secrets<br/>credential vault<br/>envelope encryption · LocalKms<br/>redaction-safe SecretValue"]
  end

  subgraph dat["Data & external"]
    direction TB
    pg[("Postgres<br/>+ pgvector")]
    rd[("Redis")]
    an{{Anthropic API}}
    vo{{Voyage API}}
    gha{{GitHub API}}
    ext{{other MCP tool servers}}
  end

  user -->|define agent recipes| reg
  user -->|start / watch runs| orc
  reg --> pg
  orc <-->|start · query · signal| tmp
  tmp <-->|poll · report| wkr
  wkr --- wf
  orc --- wf
  wkr -.->|per step · planned wiring| ag
  reg -.->|loads agent recipes · planned| ag
  ag --> lm
  ag -.->|tool calls · planned| mc
  lm --> an
  ag -->|embeddings| vo
  ag -->|working memory| rd
  ag -->|vector recall| pg
  lm -->|token & cost usage| pg
  mc -.->|connect · gate| gh
  mc -.->|connect · planned| ext
  mc -.->|resolve secret refs at connect| sec
  ag -.->|redact secrets from telemetry| sec
  gh -.->|GitHub API · planned auth| gha

  classDef planned stroke-dasharray:6 4,stroke:#a36,color:#a36;
  class ext planned;
```

**Reading it:**
- **Registry** is the catalog of *agent recipes* (system prompt, model policy, tools, guardrails), versioned in Postgres.
- **Orchestrator** is the run API: it validates a workflow, hands it to **Temporal**, and streams live per-step status back over SSE.
- **Temporal** holds the durable run state; the **Worker** is the stateless process that actually executes each step. Kill the worker and a new one resumes — state lives in Temporal.
- The **libraries** are the reusable brains: `@helix/workflow` (DAG engine), `@helix/agent` (the agent loop + memory + tracing), `@helix/llm` (the model gateway), `@helix/mcp` (tool access).
- **Dashed** edges are the next integrations: the worker currently runs a *stub* step executor; wiring it to the real agent loop — which in turn uses the LLM gateway, memory, and MCP tools — is the upcoming agent epics (HELIX-4..8) on top of MCP (HELIX-3).

---

## 2. A workflow run in motion

The "in sync" view: starting a run and watching it complete. (The agent loop step is the
planned wiring; today a stub executor stands in.)

```mermaid
sequenceDiagram
  actor U as User
  participant O as Orchestrator API
  participant T as Temporal
  participant W as Worker
  participant A as Agent loop (planned)
  participant L as LLM Gateway
  participant X as Anthropic

  U->>O: POST /api/runs (workflow DSL)
  O->>O: validate DAG (assertValidWorkflow)
  O->>T: start executeWorkflow
  O-->>U: { workflowId, runId }
  U->>O: GET /api/runs/:id/stream (SSE)

  loop each DAG level / step
    T->>W: dispatch step activity (per retry policy)
    W->>A: run step (by agentRole)
    A->>L: generate (model tier, within budget)
    L->>X: messages.create
    X-->>L: completion + token usage
    L-->>A: result (metered, cost-capped)
    A-->>W: { status, output }
    W-->>T: complete activity (checkpointed)
    O->>T: query workflowProgress
    O-->>U: SSE: step transition
  end

  T-->>O: run completed
  O-->>U: SSE: done
```

**Human-in-the-loop:** a step can call `awaitApproval` — the run *durably pauses*, the
orchestrator surfaces an approval request, and a human decision (`submitApprovalDecision`)
resumes it. Idempotency keys ensure a retried step doesn't repeat side effects.

---

## 3. Build status

| Epic | Status | What it gives us |
|---|---|---|
| **HELIX-1 · Core Agent Platform** | ✅ done | Agent definitions + registry API; LLM gateway (routing, cost, resilience, metering); agent loop with guardrails, structured output, working memory, vector recall, tracing |
| **HELIX-2 · Workflow Engine** | ✅ done | Define → compile → run a DAG; durable execution on Temporal; human pause/resume; per-step retries; orchestrator run API + live SSE status |
| **HELIX-3 · MCP Integration Layer** | ✅ done | MCP client + server registry + tool catalog (HELIX-22); tool permissioning/quota/approval (HELIX-23); GitHub MCP server + App-token auth (HELIX-24); secrets vault — encrypted at rest, JIT injection, telemetry redaction (HELIX-25) |
| HELIX-4..8 · Agents (planning/coding/review/testing/deploy) | ⬜ | Replace the stub step executor with real agents |
| HELIX-9 Approvals · HELIX-10 Monitoring · HELIX-11 SaaS | ⬜ | Human approval system, observability, and the user-facing UI |

---

## 4. Where each piece lives

| Component | Path |
|---|---|
| LLM gateway | [libs/llm](../libs/llm) (`@helix/llm`) |
| Agent runtime | [libs/agent](../libs/agent) (`@helix/agent`) |
| Workflow engine | [libs/workflow](../libs/workflow) (`@helix/workflow`, incl. `lib/temporal/`) |
| MCP integration | [libs/mcp](../libs/mcp) (`@helix/mcp`) |
| GitHub MCP server | [libs/github-mcp](../libs/github-mcp) (`@helix/github-mcp`) |
| Secrets vault | [libs/secrets](../libs/secrets) (`@helix/secrets`) |
| Registry service | [apps/registry](../apps/registry) |
| Orchestrator service | [apps/orchestrator](../apps/orchestrator) |
| Local worker (dev) | [libs/workflow/src/dev-worker.ts](../libs/workflow/src/dev-worker.ts) |
