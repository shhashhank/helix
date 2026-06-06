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
    pl["@helix/planning<br/>Planning Agent<br/>requirement extraction → spec<br/>ambiguity detection (confidence) · clarification loop<br/>task decomposition → validated DAG + waves<br/>tech-stack + scaffold · codebase grounding"]
    sbx["@helix/sandbox<br/>ephemeral workspace provisioning<br/>local temp-dir provider · path-escape guard<br/>repo checkout + workspace mount<br/>egress allowlist · resource limits<br/>command runner (spawn in workspace)"]
    cag["@helix/coding-agent<br/>Coding Agent<br/>file edit tools (read/write/patch in sandbox)<br/>scaffold generators · NestJS CRUD exemplar<br/>workspace diff · commit grouping<br/>build/lint checks · error→fix feedback<br/>self-correction loop (budget · escalate)<br/>branch naming + creation · commit messages"]
    rev["@helix/review-agent<br/>Code Review Agent<br/>diff + surrounding-code context assembly<br/>multi-aspect review (correctness/security/style/perf/plan)<br/>structured findings · severity · secret scan<br/>inline + summary posting · merge gate (severity threshold)"]
    tst["@helix/testing-agent<br/>Testing Agent<br/>test generation prompts per framework (jest/pytest/…)<br/>acceptance-criteria → tests (traceable) · coverage<br/>framework detection · run tests in sandbox<br/>result + coverage parsing (normalized)"]
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
  pl -.->|structured-output extraction| lm
  pl -.->|codebase grounding · retriever seam| ag
  cag -.->|file edits + checks in workspace| sbx
  cag -.->|commit messages · LLM with fallback| lm
  rev -.->|aspect reviews| lm
  tst -.->|test generation| lm
  tst -.->|run tests in sandbox| sbx
  rev -.->|post review · planned · GitHub tools| gh
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
| **HELIX-4 · Planning Agent** | ✅ done | NL request → validated requirements spec + clarification loop (HELIX-26); implementation plan — task graph, dependency ordering, tech-stack/scaffold (HELIX-27); codebase grounding (HELIX-28). The plan is the Coding Agent's input contract |
| **HELIX-5 · Coding Agent** | ✅ done | Isolated sandbox — provision, repo checkout, egress/limits, command runner (HELIX-29); file edit tools, scaffolding, diff + commit grouping (HELIX-30); build/lint runner, error→fix feedback, self-correction loop (HELIX-31); branch naming + commit messages (HELIX-32). Generates compiling, lint-passing changes on a branch |
| **HELIX-6 · Code Review Agent** | ✅ done | Diff-aware review engine — context assembly, multi-aspect review (correctness/security/style/perf/plan), structured findings + severity (HELIX-33); gitleaks-style secret scan (HELIX-34); inline + summary comment posting + a severity-threshold merge gate (HELIX-35). Reviews the Coding Agent's diffs and blocks or approves per policy |
| **HELIX-7 · Testing Agent** | 🛠️ in progress | Generate tests (per-framework), run them in the sandbox, report results/coverage, and loop failures back to the Coding Agent. Per-framework test-generation prompts landed (HELIX-117) |
| HELIX-8 · Deployment Agent | ⬜ | Replace the stub step executor with the deployment agent |
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
| Planning Agent | [libs/planning](../libs/planning) (`@helix/planning`) |
| Sandbox | [libs/sandbox](../libs/sandbox) (`@helix/sandbox`) |
| Coding Agent | [libs/coding-agent](../libs/coding-agent) (`@helix/coding-agent`) |
| Code Review Agent | [libs/review-agent](../libs/review-agent) (`@helix/review-agent`) |
| Testing Agent | [libs/testing-agent](../libs/testing-agent) (`@helix/testing-agent`) |
| Registry service | [apps/registry](../apps/registry) |
| Orchestrator service | [apps/orchestrator](../apps/orchestrator) |
| Local worker (dev) | [libs/workflow/src/dev-worker.ts](../libs/workflow/src/dev-worker.ts) |
