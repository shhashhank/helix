# Helix — AI Engineering Organization as a Service
## Complete Product Plan, Backlog & Architecture

> **Product**: Helix (codename) — *AI Engineering Organization as a Service*
> **One-liner**: Give Helix a software request; a fleet of autonomous, human-supervised agents plans, codes, tests, reviews, ships, and monitors it — like hiring an entire engineering org on demand.
> **Author**: Product / Architecture
> **Status**: v1 Planning

---

## Table of Contents

1. [Product Thesis & Positioning](#1-product-thesis--positioning)
2. [Complete Jira Backlog (Initiative → Epic → Story → Task)](#2-complete-jira-backlog)
3. [MVP Scope](#3-mvp-scope)
4. [Post-MVP Scope](#4-post-mvp-scope)
5. [Epic Dependency Graph](#5-epic-dependency-graph)
6. [Development Phases](#6-development-phases)
7. [30-Day Roadmap](#7-30-day-roadmap)
8. [90-Day Roadmap](#8-90-day-roadmap)
9. [v1 Architecture Diagram](#9-v1-architecture-diagram)
10. [Database Schema](#10-database-schema)
11. [Microservice Breakdown](#11-microservice-breakdown)
12. [API List](#12-api-list)
13. [MCP Tool Integration Strategy](#13-mcp-tool-integration-strategy)
14. [Agent Communication Protocol](#14-agent-communication-protocol)
15. [Event-Driven Architecture Design](#15-event-driven-architecture-design)
16. [AWS Deployment Architecture](#16-aws-deployment-architecture)
17. [MVP Cost Estimation](#17-mvp-cost-estimation)

---

## 1. Product Thesis & Positioning

**Problem.** Engineering capacity is the bottleneck for every software company. Hiring is slow and expensive; AI coding copilots help individuals but don't replace the *organizational workflow* (plan → build → test → review → ship → monitor) or the *governance* (approvals, audit, cost control) that real teams require.

**Solution.** Helix orchestrates specialized LLM agents through a durable workflow engine. Each agent maps to an engineering role, talks to real tools via MCP (GitHub, Jira, AWS, CI), and pauses for human approval at the moments that matter. The output is not a snippet — it's a merged PR and a deployed, monitored service.

**Why now.** Frontier models can now reliably plan and write multi-file changes; MCP standardizes tool access; durable workflow engines (Temporal-class) make long-running, human-in-the-loop agent runs reliable.

**Target customers.**
- Seed/Series-A startups without enough engineers.
- Platform/DevEx teams at mid-size companies offloading routine service creation.
- Agencies/consultancies needing throughput.

**Moat.** (1) Workflow reliability + audit trail; (2) governance/approvals as a first-class product; (3) accumulated org-specific context (codebase memory, conventions); (4) cost-optimized model routing.

**Pricing direction (hypothesis).** Usage-based on "agent-runs" + seat-based for governance/observability; enterprise tier for SSO, VPC, audit retention.

---

## 2. Complete Jira Backlog

> Hierarchy: **Initiative → Epic → Story → Task**. Complexity is **S** (≤2d), **M** (3–5d), **L** (1–2+ weeks).

### INITIATIVE: Helix — Autonomous AI Engineering Organization Platform

---

### EPIC 1 — Core Agent Platform

- **Epic Goal**: Provide the foundational runtime that defines, hosts, and executes LLM-powered agents with shared memory, model routing, and tool access.
- **Business Value**: Every higher-level capability (planning, coding, review) is built on this. Reliable, observable, cost-controlled agent execution is the platform's spine.
- **Acceptance Criteria**:
  - An agent can be defined declaratively (role, system prompt, tools, model policy) and executed against a request.
  - Agents stream tokens, emit structured events, and persist their full trace.
  - Model routing selects models by task/cost policy with automatic fallback.
  - Per-run token + cost accounting is recorded and queryable.

#### Story 1.1 — Agent Definition & Registry
- **User Story**: *As a platform engineer, I want to define agents declaratively so that new agent roles can be added without code changes.*
- **Description**: A schema-driven agent definition (role, prompt template, allowed tools, model policy, guardrails) stored in a registry and versioned.
- **Acceptance Criteria**: Agent definitions are CRUD-able via API; versioned; validated against schema; retrievable by the runtime at execution time.
- **Dependencies**: None (foundational).
- **Tasks**:
  - **Agent definition schema** — JSON schema for role/prompt/tools/model-policy/guardrails; semantic versioning. *(M)*
  - **Agent registry service + persistence** — Postgres-backed CRUD, version history, soft delete. *(M)*
  - **Prompt template engine** — variable interpolation, partials, context injection. *(M)*
  - **Registry API endpoints** — `POST/GET/PUT /agents`, validation, OpenAPI. *(S)*

#### Story 1.2 — LLM Gateway & Model Router
- **User Story**: *As a platform engineer, I want a unified LLM gateway so agents can call multiple model providers with consistent routing, retries, and cost tracking.*
- **Description**: Abstraction over Anthropic + others; routing by task class and cost policy; retries, timeouts, fallback.
- **Acceptance Criteria**: Single internal API for completions/tools/streaming; provider failover works; every call emits token+cost telemetry; routing policy configurable per agent.
- **Dependencies**: 1.1.
- **Tasks**:
  - **Provider adapters (Anthropic primary)** — normalize messages, tool-use, streaming. *(M)*
  - **Routing policy engine** — map task class → model tier (Opus/Sonnet/Haiku) with cost ceilings. *(M)*
  - **Retry/fallback/timeout middleware** — exponential backoff, circuit breaker, provider failover. *(M)*
  - **Token & cost meter** — per-call usage capture, write to billing/usage table. *(S)*

#### Story 1.3 — Agent Execution Runtime (Agent Loop)
- **User Story**: *As a developer, I want a reliable agent loop so an agent can reason, call tools, observe results, and produce a final output.*
- **Description**: The core ReAct-style loop: model call → tool calls → observations → iterate until done or budget exhausted.
- **Acceptance Criteria**: Loop handles multi-step tool use; enforces max-iterations + token budget; emits step events; produces structured final output.
- **Dependencies**: 1.1, 1.2, Epic 3 (tool execution).
- **Tasks**:
  - **Core agent loop** — tool-use orchestration, observation handling, stop conditions. *(L)*
  - **Budget & guardrail enforcement** — max steps, token/cost ceiling, loop-detection. *(M)*
  - **Structured output parser/validator** — coerce + validate final outputs to schema. *(M)*
  - **Step event emitter** — emit `agent.step.*` events to the bus. *(S)*

#### Story 1.4 — Agent Memory & Context Store
- **User Story**: *As an agent, I want short- and long-term memory so I retain project context across steps and runs.*
- **Description**: Working memory (per-run) + long-term memory (per-project) with vector retrieval over codebase, conventions, and prior decisions.
- **Acceptance Criteria**: Agents can store/retrieve memories; retrieval returns relevant context with citations; project memory persists across runs.
- **Dependencies**: 1.3.
- **Tasks**:
  - **Working-memory store** — Redis-backed per-run scratchpad. *(S)*
  - **Vector store integration** — pgvector/OpenSearch; embeddings pipeline. *(M)*
  - **Retrieval API + ranking** — hybrid (semantic + keyword) retrieval with citations. *(M)*
  - **Memory write/curation policy** — what to persist, dedupe, TTL. *(M)*

#### Story 1.5 — Agent Tracing & Cost Accounting
- **User Story**: *As an operator, I want full agent traces and per-run cost so I can debug and bill accurately.*
- **Description**: Capture every prompt, tool call, observation, and token cost as a navigable trace.
- **Acceptance Criteria**: Each run has a complete replayable trace; cost rollups by run/project/org; traces queryable in UI.
- **Dependencies**: 1.3.
- **Tasks**:
  - **Trace schema + writer** — structured spans for steps/tool-calls/model-calls. *(M)*
  - **OpenTelemetry instrumentation** — propagate trace context across services. *(M)*
  - **Cost rollup jobs** — aggregate per run/project/org/day. *(S)*

---

### EPIC 2 — Workflow Engine

- **Epic Goal**: Durably orchestrate multi-agent pipelines (plan→code→test→review→deploy) with state, retries, human pauses, and compensation.
- **Business Value**: Turns isolated agent calls into a reliable, long-running, resumable engineering process — the core differentiator vs. a chatbot.
- **Acceptance Criteria**:
  - Workflows defined as DAGs/sagas; survive process restarts; resume after human approval; support retries + compensation; expose live status.

#### Story 2.1 — Workflow Definition & DAG Engine
- **User Story**: *As a platform engineer, I want to define workflows as DAGs so agent steps run in the right order with dependencies.*
- **Description**: Declarative workflow spec (steps, dependencies, conditions, fan-out/fan-in) compiled to executable plans.
- **Acceptance Criteria**: Workflows defined in YAML/JSON; conditional + parallel branches supported; validated before run.
- **Dependencies**: Epic 1.
- **Tasks**:
  - **Workflow DSL + validator** — schema for steps/edges/conditions. *(M)*
  - **DAG compiler/scheduler** — topological execution, parallel branches. *(L)*
  - **Workflow versioning** — pin definition version per run. *(S)*

#### Story 2.2 — Durable Execution & State Persistence
- **User Story**: *As an operator, I want workflows to survive crashes so long-running runs aren't lost.*
- **Description**: Adopt a durable execution engine (Temporal) or build state-machine persistence; checkpoint after each step.
- **Acceptance Criteria**: Killing a worker mid-run resumes from last checkpoint; no duplicate side effects (idempotency).
- **Dependencies**: 2.1.
- **Tasks**:
  - **Temporal integration (workflows + activities)** — map agent steps to activities. *(L)*
  - **Idempotency keys for side effects** — dedupe tool/external actions. *(M)*
  - **State persistence + recovery tests** — chaos restart tests. *(M)*

#### Story 2.3 — Human-in-the-Loop Pause/Resume
- **User Story**: *As a workflow author, I want steps that pause for human approval so risky actions get sign-off before proceeding.*
- **Description**: Workflow can suspend, emit an approval request, and resume on decision (approve/reject/edit).
- **Acceptance Criteria**: Workflow waits indefinitely (with timeout policy) for a signal; resumes with the human's decision payload.
- **Dependencies**: 2.2, Epic 9.
- **Tasks**:
  - **Pause/await-signal primitive** — durable wait + timeout escalation. *(M)*
  - **Approval request emitter** — publish to Approval service. *(S)*
  - **Resume-on-decision handler** — inject decision into workflow state. *(S)*

#### Story 2.4 — Retries, Compensation & Error Handling
- **User Story**: *As an operator, I want automatic retries and compensation so transient failures self-heal and partial work rolls back.*
- **Description**: Per-step retry policy; saga compensation (e.g., delete branch on abort); dead-letter for unrecoverable failures.
- **Acceptance Criteria**: Configurable retries with backoff; compensation runs on abort; failed runs land in DLQ with diagnostics.
- **Dependencies**: 2.2.
- **Tasks**:
  - **Retry policy per step** — backoff, max attempts, retryable-error classification. *(S)*
  - **Compensation/saga handlers** — undo actions for key steps. *(M)*
  - **Dead-letter + failure diagnostics** — capture context for replay. *(S)*

#### Story 2.5 — Workflow Orchestrator API & Status
- **User Story**: *As a user, I want to start, watch, and cancel workflow runs so I stay in control.*
- **Description**: API + event stream for run lifecycle and live status.
- **Acceptance Criteria**: Start/cancel/retry endpoints; live status via WebSocket/SSE; per-step status visible.
- **Dependencies**: 2.1–2.4.
- **Tasks**:
  - **Run lifecycle API** — start/cancel/retry/get. *(M)*
  - **Live status stream (SSE/WS)** — push step transitions. *(M)*

---

### EPIC 3 — MCP Integration Layer

- **Epic Goal**: A secure, governed layer that lets agents use external tools (GitHub, Jira, AWS, CI, filesystem) via the Model Context Protocol.
- **Business Value**: Tools are how agents *act*. A standardized, permissioned MCP layer makes integrations reusable, auditable, and safe.
- **Acceptance Criteria**:
  - MCP servers are registered, discoverable, health-checked; tool calls are permission-gated, rate-limited, audited; secrets never leak to the model.

#### Story 3.1 — MCP Client & Server Registry
- **User Story**: *As a platform engineer, I want to register MCP servers so agents can discover and invoke their tools.*
- **Description**: MCP client that connects to MCP servers (stdio/HTTP), lists tools, and exposes them to the agent runtime.
- **Acceptance Criteria**: Register/list/health-check MCP servers; tool catalog auto-synced; schema surfaced to agent loop.
- **Dependencies**: Epic 1.
- **Tasks**:
  - **MCP client implementation** — handshake, tool discovery, invocation. *(L)*
  - **Server registry + health checks** — register/enable/disable; liveness. *(M)*
  - **Tool catalog sync** — expose tool schemas to runtime. *(S)*

#### Story 3.2 — Tool Permissioning & Policy
- **User Story**: *As a security admin, I want per-agent/per-org tool permissions so agents only do what's allowed.*
- **Description**: Allow/deny policies, scopes, and rate limits per tool, agent, and org; approval-required flags.
- **Acceptance Criteria**: Denied calls blocked + audited; rate limits enforced; "approval-required" tools route through Epic 9.
- **Dependencies**: 3.1.
- **Tasks**:
  - **Policy model + evaluator** — RBAC/ABAC over tools. *(M)*
  - **Rate limiting + quotas** — per tool/org. *(S)*
  - **Approval-gated tool routing** — flag high-risk tools. *(S)*

#### Story 3.3 — GitHub MCP Server
- **User Story**: *As a coding agent, I want GitHub tools so I can read repos, create branches, commit, and open PRs.*
- **Description**: MCP server wrapping GitHub APIs: repo read, branch, commit, PR, comments, checks.
- **Acceptance Criteria**: Agent can clone/read, create branch, push commits, open PR, post review comments.
- **Dependencies**: 3.1, 3.2.
- **Tasks**:
  - **Repo read/search tools** — file read, tree, search. *(M)*
  - **Branch/commit/push tools** — write operations via app token. *(M)*
  - **PR + review-comment tools** — create PR, comment, request review. *(M)*
  - **GitHub App auth + installation tokens** — short-lived tokens, per-repo scope. *(M)*

#### Story 3.4 — Jira MCP Server
- **User Story**: *As an agent, I want Jira tools so I can read requirements and write back progress.*
- **Description**: MCP server for Jira: read issues/epics, create/update issues, transition statuses, comment.
- **Acceptance Criteria**: Agent reads a Jira issue as a request source and updates status/comments as work progresses.
- **Dependencies**: 3.1, 3.2.
- **Tasks**:
  - **Issue read/search tools** — JQL search, issue fetch. *(M)*
  - **Issue write/transition tools** — create/update/transition/comment. *(M)*
  - **OAuth/Atlassian Connect auth** — token mgmt + refresh. *(M)*

#### Story 3.5 — AWS MCP Server
- **User Story**: *As a deployment agent, I want AWS tools so I can provision and deploy infrastructure.*
- **Description**: MCP server for scoped AWS actions: ECS/Lambda deploy, ECR push, CloudFormation/CDK, logs.
- **Acceptance Criteria**: Agent deploys to a sandboxed AWS account with least-privilege role; actions audited.
- **Dependencies**: 3.1, 3.2.
- **Tasks**:
  - **Deploy tools (ECS/Lambda/CDK)** — invoke deployments. *(L)*
  - **ECR/artifact push tools** — image push. *(M)*
  - **Scoped IAM assume-role + guardrails** — least privilege, region/account allowlist. *(M)*

#### Story 3.6 — Secrets & Credential Vault
- **User Story**: *As a security admin, I want tool credentials stored in a vault so secrets never reach the model.*
- **Description**: Secrets resolved at tool-execution boundary, never in prompts or traces.
- **Acceptance Criteria**: Secrets encrypted at rest; injected only at call time; redacted from logs/traces.
- **Dependencies**: 3.1.
- **Tasks**:
  - **Secrets manager integration** — AWS Secrets Manager/KMS. *(M)*
  - **Just-in-time credential injection** — resolve at execution boundary. *(M)*
  - **Trace/log redaction** — scrub secrets from all telemetry. *(S)*

---

### EPIC 4 — Planning Agent

- **Epic Goal**: Convert a natural-language request into a validated requirements spec and a structured, dependency-aware implementation plan.
- **Business Value**: Plan quality determines run quality. Good planning reduces rework, cost, and human review load.
- **Acceptance Criteria**:
  - Produces a structured spec + task graph; flags ambiguities for clarification; plan is the input contract for the Coding Agent.

#### Story 4.1 — Requirement Analysis & Clarification
- **User Story**: *As a user, I want the planner to analyze my request and ask clarifying questions so the plan reflects intent.*
- **Description**: Parse request, infer scope/constraints, detect ambiguity, generate clarifying questions.
- **Acceptance Criteria**: Outputs a structured requirements doc; raises clarifying questions when confidence is low; incorporates answers.
- **Dependencies**: Epic 1, Epic 3 (Jira read).
- **Tasks**:
  - **Requirement extraction prompt + schema** — structured spec output. *(M)*
  - **Ambiguity detection + question generation** — confidence thresholds. *(M)*
  - **Clarification loop integration** — pause for user answers. *(S)*

#### Story 4.2 — Implementation Plan Generation
- **User Story**: *As a coding agent, I want a dependency-ordered task plan so I can implement step by step.*
- **Description**: Decompose spec into ordered tasks with files, interfaces, acceptance tests, and estimates.
- **Acceptance Criteria**: Plan is a validated task graph; each task has clear done-criteria; ordering respects dependencies.
- **Dependencies**: 4.1.
- **Tasks**:
  - **Task decomposition prompt + schema** — task graph output. *(M)*
  - **Dependency ordering + validation** — cycle detection, topo sort. *(M)*
  - **Tech-stack/scaffold selection** — choose framework/templates. *(M)*

#### Story 4.3 — Plan Review & Codebase Grounding
- **User Story**: *As a planner, I want to ground plans in the existing codebase so changes fit current conventions.*
- **Description**: Retrieve relevant code/conventions via memory; adapt plan to existing architecture.
- **Acceptance Criteria**: Plan references real files/modules; respects detected conventions; flags conflicts.
- **Dependencies**: 4.2, Story 1.4.
- **Tasks**:
  - **Codebase context retrieval** — pull relevant files/conventions. *(M)*
  - **Plan grounding + conflict detection** — reconcile with existing code. *(M)*

---

### EPIC 5 — Coding Agent

- **Epic Goal**: Generate and modify multi-file code to satisfy a plan, in an isolated workspace, with iterative self-correction.
- **Business Value**: The core value-producing step — turns plans into working, committed code.
- **Acceptance Criteria**:
  - Produces compiling, lint-passing, multi-file changes in a sandbox; commits to a branch; iterates on test/lint feedback.

#### Story 5.1 — Isolated Workspace / Sandbox
- **User Story**: *As an operator, I want code generated in an isolated sandbox so untrusted execution is contained.*
- **Description**: Per-run ephemeral container/workspace with the repo checked out, network egress controlled.
- **Acceptance Criteria**: Each run gets a clean, isolated FS; resource-limited; destroyed after run; no host access.
- **Dependencies**: Epic 1, Epic 3 (GitHub).
- **Tasks**:
  - **Ephemeral sandbox provisioning** — container/microVM (Firecracker/Fargate). *(L)*
  - **Repo checkout + workspace mount** — clone target repo/branch. *(M)*
  - **Egress controls + resource limits** — network allowlist, CPU/mem caps. *(M)*

#### Story 5.2 — Code Generation & Multi-File Editing
- **User Story**: *As a coding agent, I want to read and edit multiple files so I can implement a task end to end.*
- **Description**: File read/write/patch tools; scaffold generation; framework-aware edits (e.g., NestJS modules/controllers/services).
- **Acceptance Criteria**: Generates coherent multi-file changes; produces valid diffs; matches plan tasks.
- **Dependencies**: 5.1, Epic 4.
- **Tasks**:
  - **File edit tools (read/write/patch)** — in sandbox. *(M)*
  - **Scaffolding/templates (NestJS CRUD exemplar)** — generators per stack. *(M)*
  - **Diff generation + commit grouping** — logical commits per task. *(M)*

#### Story 5.3 — Build, Lint & Self-Correction Loop
- **User Story**: *As a coding agent, I want to compile and lint my code and fix errors so output is valid before review.*
- **Description**: Run build/lint in sandbox; feed errors back; iterate until green or budget exhausted.
- **Acceptance Criteria**: Code compiles and passes lint before handing off; failures captured and retried with limits.
- **Dependencies**: 5.1, 5.2.
- **Tasks**:
  - **Build/lint runner in sandbox** — language-aware commands. *(M)*
  - **Error feedback → fix loop** — parse errors, re-prompt, re-run. *(M)*
  - **Iteration budget + bail-out** — max attempts, escalate to human. *(S)*

#### Story 5.4 — Commit & Branch Management
- **User Story**: *As a coding agent, I want to commit to a feature branch so changes are ready for review/PR.*
- **Description**: Create branch, stage logical commits with messages, push.
- **Acceptance Criteria**: Clean branch with descriptive commits pushed to remote.
- **Dependencies**: 5.3, Story 3.3.
- **Tasks**:
  - **Branch creation + naming convention** — `helix/<run-id>/<slug>`. *(S)*
  - **Commit message generation** — conventional commits. *(S)*

---

### EPIC 6 — Code Review Agent

- **Epic Goal**: Automatically review generated code for correctness, security, style, and plan-conformance, and post actionable feedback.
- **Business Value**: Quality gate that builds trust and reduces human review burden; catches issues before merge.
- **Acceptance Criteria**:
  - Produces structured findings (severity, file/line, suggestion); blocks or approves per policy; posts inline PR comments.

#### Story 6.1 — Diff-Aware Review Engine
- **User Story**: *As a reviewer agent, I want to analyze the PR diff so I focus review on what changed.*
- **Description**: Fetch diff, build context (changed files + neighbors), run multi-aspect review.
- **Acceptance Criteria**: Findings reference exact file/line; categorized (bug/security/style/perf); severity-rated.
- **Dependencies**: Epic 1, Story 3.3.
- **Tasks**:
  - **Diff fetch + context assembly** — changed hunks + surrounding code. *(M)*
  - **Multi-aspect review prompts** — correctness/security/style/perf. *(M)*
  - **Findings schema + severity model** — structured output. *(S)*

#### Story 6.2 — Security & Standards Checks
- **User Story**: *As a security-minded team, I want automated security/standards checks so vulnerabilities are caught.*
- **Description**: Integrate SAST/secret-scan + LLM security review; enforce org coding standards.
- **Acceptance Criteria**: Common vulns (injection, secrets, authz) flagged; standards violations reported.
- **Dependencies**: 6.1.
- **Tasks**:
  - **SAST + secret scan integration** — e.g., Semgrep, gitleaks. *(M)*
  - **LLM security review pass** — context-aware vuln detection. *(M)*
  - **Org standards ruleset** — configurable conventions. *(S)*

#### Story 6.3 — Review Posting & Merge Gate
- **User Story**: *As a user, I want review results posted to the PR with a clear gate so I know if it's safe to merge.*
- **Description**: Post inline comments + summary; set pass/fail status check; recommend approve/changes.
- **Acceptance Criteria**: Inline comments posted; PR status check set; merge blocked on critical findings per policy.
- **Dependencies**: 6.1, 6.2, Story 3.3.
- **Tasks**:
  - **Inline + summary comment posting** — via GitHub MCP. *(M)*
  - **Status check / merge gate** — block on severity threshold. *(S)*

---

### EPIC 7 — Testing Agent

- **Epic Goal**: Generate, run, and report tests (unit/integration) for the produced code, and feed failures back to coding.
- **Business Value**: Verifiable correctness — the difference between "code that looks right" and "code that works."
- **Acceptance Criteria**:
  - Generates relevant tests; executes them in sandbox; reports coverage + results; failures loop back to Coding Agent.

#### Story 7.1 — Test Generation
- **User Story**: *As a testing agent, I want to generate tests from the spec and code so behavior is verified.*
- **Description**: Derive unit/integration tests from plan acceptance criteria + code surface.
- **Acceptance Criteria**: Tests map to acceptance criteria; runnable; cover happy + edge paths.
- **Dependencies**: Epic 5, Epic 4.
- **Tasks**:
  - **Test generation prompts per framework** — Jest/PyTest/etc. *(M)*
  - **Acceptance-criteria → test mapping** — traceability. *(M)*

#### Story 7.2 — Test Execution & Reporting
- **User Story**: *As a user, I want tests run automatically with a clear report so I trust the result.*
- **Description**: Execute test suite in sandbox; parse results; compute coverage; produce report.
- **Acceptance Criteria**: Pass/fail + coverage reported; flaky/error distinguished; artifacts saved.
- **Dependencies**: 7.1, Story 5.1.
- **Tasks**:
  - **Test runner in sandbox** — framework detection + run. *(M)*
  - **Result + coverage parser** — normalize across frameworks. *(M)*
  - **Test report artifact** — store + surface in UI. *(S)*

#### Story 7.3 — Failure Feedback Loop
- **User Story**: *As a workflow, I want test failures routed back to coding so the agent can fix them.*
- **Description**: On failure, package diagnostics and re-invoke Coding Agent within iteration budget.
- **Acceptance Criteria**: Failures trigger fix attempts up to a cap, then escalate to human.
- **Dependencies**: 7.2, Epic 5, Epic 2.
- **Tasks**:
  - **Failure diagnostics packaging** — failing tests + stack traces. *(S)*
  - **Re-invoke coding step + budget** — workflow loop with cap. *(M)*

---

### EPIC 8 — Deployment Agent

- **Epic Goal**: Package, deploy, and verify the application to a target environment (AWS), with rollback on failure.
- **Business Value**: Closes the loop from request to running software — the "ship" step that completes the org analogy.
- **Acceptance Criteria**:
  - Builds artifact, deploys to target env, runs health/smoke checks, rolls back on failure, reports the live URL/status.

#### Story 8.1 — Build & Artifact Packaging
- **User Story**: *As a deployment agent, I want to build a deployable artifact so the app can run in the cloud.*
- **Description**: Containerize/package app; push to registry.
- **Acceptance Criteria**: Reproducible image/artifact built + pushed; tagged with run/commit.
- **Dependencies**: Epic 5, Story 3.5.
- **Tasks**:
  - **Dockerfile/buildpack detection + build** — per stack. *(M)*
  - **Image push to ECR** — tag + push. *(S)*

#### Story 8.2 — Deploy to Target Environment
- **User Story**: *As a user, I want my app deployed to a target environment so I can use it.*
- **Description**: Deploy via IaC (CDK/CloudFormation) to ECS/Lambda; manage env config.
- **Acceptance Criteria**: App deployed to isolated env; config/secrets wired; endpoint returned.
- **Dependencies**: 8.1, Story 3.5.
- **Tasks**:
  - **IaC deploy (CDK) for ECS/Lambda** — provision + deploy. *(L)*
  - **Env/config + secrets wiring** — env vars from vault. *(M)*

#### Story 8.3 — Health Checks & Rollback
- **User Story**: *As an operator, I want post-deploy verification and rollback so bad deploys don't stay live.*
- **Description**: Smoke/health checks post-deploy; auto-rollback (saga compensation) on failure.
- **Acceptance Criteria**: Failed health checks trigger rollback to prior version; status reported.
- **Dependencies**: 8.2, Story 2.4.
- **Tasks**:
  - **Health/smoke check runner** — probe endpoints. *(M)*
  - **Rollback/compensation** — revert to last good. *(M)*

---

### EPIC 9 — Human Approval System

- **Epic Goal**: First-class human-in-the-loop governance: approval gates, notifications, decision capture, and audit.
- **Business Value**: Trust and safety. Enterprises won't let autonomous agents merge/deploy without controllable sign-off and audit.
- **Acceptance Criteria**:
  - Configurable gates pause workflows; approvers are notified; decisions (approve/reject/edit) captured + audited; SLAs/escalation enforced.

#### Story 9.1 — Approval Gate Configuration
- **User Story**: *As an admin, I want to configure where approvals are required so governance matches our risk tolerance.*
- **Description**: Policy defining which steps/tools require approval, by whom, with SLAs.
- **Acceptance Criteria**: Gates configurable per workflow/step/tool/org; approver roles assignable.
- **Dependencies**: Epic 2.
- **Tasks**:
  - **Approval policy model** — gate rules, approver roles, SLAs. *(M)*
  - **Policy admin API/UI** — manage gates. *(M)*

#### Story 9.2 — Approval Request & Decision Flow
- **User Story**: *As an approver, I want to review context and approve/reject/edit so I control what agents do.*
- **Description**: Approval inbox with diff/plan context; decision actions; resume workflow on decision.
- **Acceptance Criteria**: Approver sees full context; can approve/reject/request-changes/edit; decision resumes workflow.
- **Dependencies**: 9.1, Story 2.3.
- **Tasks**:
  - **Approval service + state machine** — pending/approved/rejected. *(M)*
  - **Decision API + workflow signal** — resume on decision. *(M)*
  - **Approval inbox UI** — context + actions. *(M)*

#### Story 9.3 — Notifications & Escalation
- **User Story**: *As an approver, I want timely notifications and escalation so approvals don't stall delivery.*
- **Description**: Slack/email/in-app notifications; SLA timers; escalate to backup approver.
- **Acceptance Criteria**: Approvers notified on request; reminders sent; SLA breach escalates; timeout policy applied.
- **Dependencies**: 9.2.
- **Tasks**:
  - **Notification dispatch (Slack/email/in-app)** — channels. *(M)*
  - **SLA timers + escalation** — reminders, backup approver. *(M)*

#### Story 9.4 — Audit Log
- **User Story**: *As a compliance officer, I want an immutable audit trail so every action and approval is accountable.*
- **Description**: Append-only log of agent actions, tool calls, decisions, deploys.
- **Acceptance Criteria**: Tamper-evident, queryable, exportable audit log with actor/time/context.
- **Dependencies**: 9.2, Epic 3.
- **Tasks**:
  - **Append-only audit store** — immutable + hash-chained. *(M)*
  - **Audit query + export API** — filter/export. *(S)*

---

### EPIC 10 — Monitoring & Observability

- **Epic Goal**: Observe agents, workflows, costs, and deployed apps; alert on anomalies.
- **Business Value**: Operability and cost control. You can't run a fleet of autonomous agents you can't see.
- **Acceptance Criteria**:
  - Metrics/logs/traces for all services and runs; cost dashboards; alerting; deployed-app monitoring surfaced to users.

#### Story 10.1 — Telemetry Pipeline (Logs/Metrics/Traces)
- **User Story**: *As an operator, I want centralized telemetry so I can debug and measure the platform.*
- **Description**: OpenTelemetry across services; centralized logs/metrics/traces.
- **Acceptance Criteria**: All services emit OTel; traces correlate request→workflow→agent→tool; dashboards available.
- **Dependencies**: Epics 1–3.
- **Tasks**:
  - **OTel SDK + collector** — instrument services. *(M)*
  - **Metrics/log/trace backend** — Prometheus/Grafana/Tempo or managed. *(M)*
  - **Correlation IDs end-to-end** — propagate run/trace IDs. *(S)*

#### Story 10.2 — Run & Cost Dashboards
- **User Story**: *As an admin, I want run-success and cost dashboards so I can manage quality and spend.*
- **Description**: Dashboards for run outcomes, latency, token/$ per run, per-org spend.
- **Acceptance Criteria**: Success rate, duration, cost-per-run, org spend visible + filterable.
- **Dependencies**: 10.1, Story 1.5.
- **Tasks**:
  - **Run analytics aggregation** — success/latency/cost rollups. *(M)*
  - **Dashboards** — Grafana/managed dashboards. *(S)*

#### Story 10.3 — Alerting & Anomaly Detection
- **User Story**: *As an operator, I want alerts on failures and cost spikes so I respond fast.*
- **Description**: Alert rules on error rates, cost spikes, stuck workflows, deploy failures.
- **Acceptance Criteria**: Alerts fire to Slack/PagerDuty; thresholds configurable; runbooks linked.
- **Dependencies**: 10.1.
- **Tasks**:
  - **Alert rules + routing** — thresholds, channels. *(M)*
  - **Cost-spike + stuck-run detectors** — anomaly rules. *(S)*

#### Story 10.4 — Deployed-App Monitoring
- **User Story**: *As a user, I want monitoring of my deployed app so I see its health.*
- **Description**: Surface CloudWatch metrics/logs for apps deployed by the Deployment Agent.
- **Acceptance Criteria**: App health/metrics/logs visible in Helix UI.
- **Dependencies**: Epic 8, 10.1.
- **Tasks**:
  - **CloudWatch ingestion** — pull app metrics/logs. *(M)*
  - **Per-app health view** — UI surface. *(S)*

---

### EPIC 11 — SaaS Platform

- **Epic Goal**: Multi-tenant SaaS shell: auth, orgs, billing, dashboard UI, and the request-submission experience.
- **Business Value**: The commercial wrapper that turns the engine into a product customers can sign up for and pay.
- **Acceptance Criteria**:
  - Users sign up, join orgs, submit requests, watch runs, manage approvals/billing; tenant isolation enforced.

#### Story 11.1 — Auth, Orgs & RBAC
- **User Story**: *As a user, I want secure sign-in and org-based access so my team's data is isolated and roles enforced.*
- **Description**: SSO/OAuth auth, multi-tenant orgs, roles (admin/approver/member), tenant isolation.
- **Acceptance Criteria**: Users sign in via OAuth/SSO; org membership + roles enforced; row-level tenant isolation.
- **Dependencies**: None (foundational SaaS).
- **Tasks**:
  - **Auth (OIDC/OAuth) + session** — e.g., Auth0/Cognito. *(M)*
  - **Org/tenant model + isolation** — row-level scoping. *(M)*
  - **RBAC roles + enforcement** — middleware/guards. *(M)*

#### Story 11.2 — Request Submission & Run Dashboard
- **User Story**: *As a user, I want to submit a request and watch the run so I can follow progress.*
- **Description**: UI to submit requests (free text or Jira link), see live workflow status, traces, artifacts.
- **Acceptance Criteria**: Submit request → workflow starts; live step status; view PR/test/deploy artifacts.
- **Dependencies**: Epics 2, 11.1.
- **Tasks**:
  - **Request submission UI + API** — form + start workflow. *(M)*
  - **Run dashboard (live status + traces)** — SSE-driven UI. *(L)*
  - **Artifact views (PR/tests/deploy)** — surface outputs. *(M)*

#### Story 11.3 — Billing & Usage Metering
- **User Story**: *As an admin, I want usage-based billing so we pay for what we use.*
- **Description**: Meter agent-runs + tokens; integrate Stripe; plans + quotas.
- **Acceptance Criteria**: Usage metered per org; invoices via Stripe; quota enforcement + overage handling.
- **Dependencies**: 11.1, Story 1.5.
- **Tasks**:
  - **Usage metering pipeline** — aggregate runs/tokens/$. *(M)*
  - **Stripe integration (plans/invoices)** — subscriptions + metered. *(M)*
  - **Quota + overage enforcement** — limits per plan. *(M)*

#### Story 11.4 — Onboarding & Integration Setup
- **User Story**: *As a new org, I want guided setup of GitHub/Jira/AWS so I can start fast.*
- **Description**: Connect integrations (GitHub App install, Jira OAuth, AWS role) via guided flow.
- **Acceptance Criteria**: Org connects GitHub/Jira/AWS through wizard; credentials stored in vault; test connection passes.
- **Dependencies**: Epic 3, 11.1.
- **Tasks**:
  - **Integration connect wizard** — OAuth/app-install flows. *(M)*
  - **Connection health/test** — verify access. *(S)*

---

## 3. MVP Scope

**MVP goal**: Demonstrate the end-to-end happy path — *"Build a NestJS CRUD API for Products"* → Planning → Coding → Testing → Review → **GitHub PR** → (optional) Deploy — with **one human approval gate** before PR, full traceability, and basic multi-tenant SaaS.

**Deliberate MVP constraints** (narrow to ship):
- Single primary stack target: **NestJS/TypeScript** (CRUD exemplar).
- Integrations: **GitHub (required)**, **Jira read (optional)**, **AWS deploy (single demo stack, behind approval)**.
- One workflow template (the canonical pipeline), not a workflow builder.
- One approval gate (pre-PR), Slack + in-app notifications.
- Anthropic as sole LLM provider (router stubbed for future multi-provider).

**In MVP (by epic/story):**

| Epic | MVP Stories |
|---|---|
| 1 Core Agent Platform | 1.1, 1.2 (Anthropic only), 1.3, 1.4 (basic), 1.5 |
| 2 Workflow Engine | 2.1, 2.2, 2.3, 2.5 (2.4 minimal: retries only) |
| 3 MCP Integration | 3.1, 3.2 (basic), 3.3 (GitHub), 3.6 (secrets) |
| 4 Planning Agent | 4.1, 4.2 (4.3 basic grounding) |
| 5 Coding Agent | 5.1, 5.2, 5.3, 5.4 |
| 6 Code Review Agent | 6.1, 6.3 (6.2 basic: secret scan only) |
| 7 Testing Agent | 7.1, 7.2, 7.3 |
| 8 Deployment Agent | 8.1, 8.2 (single demo stack) — *optional/feature-flagged* |
| 9 Human Approval | 9.1 (basic), 9.2, 9.3 (Slack+email), 9.4 (basic audit) |
| 10 Observability | 10.1, 10.2 (basic cost dashboard) |
| 11 SaaS Platform | 11.1, 11.2, 11.4 (GitHub connect) |

**MVP success metrics:**
- ≥70% of canonical CRUD requests reach a green PR without human code edits.
- Median run cost < target $ ceiling; full trace available for 100% of runs.
- Time-to-PR < 15 min for the exemplar.

---

## 4. Post-MVP Scope

**Phase 2 (Productization):**
- Multi-stack support (Python/FastAPI, Go, Next.js).
- Jira write-back + AWS MCP full deploy with health checks/rollback (8.3).
- Full review security suite (6.2 SAST), merge gates by policy.
- Workflow retries/compensation (2.4 full), DLQ + replay.
- Billing (11.3), quotas, plans, Stripe.
- Observability: alerting (10.3), deployed-app monitoring (10.4).

**Phase 3 (Scale & Enterprise):**
- Visual workflow/agent builder; custom agents per org.
- Multi-provider model routing + cost optimization.
- Long-term codebase memory & org conventions learning.
- Enterprise: SSO/SAML, VPC/private deployment, SOC 2, audit retention/export.
- Marketplace for MCP tools and agent templates.
- Parallel multi-agent collaboration (concurrent feature streams).

---

## 5. Epic Dependency Graph

```
                         ┌─────────────────────────┐
                         │ E11 SaaS Platform        │
                         │ (Auth/Orgs/UI/Billing)   │
                         └───────────┬──────────────┘
                                     │ (shell + tenancy)
        ┌────────────────────────────┼───────────────────────────┐
        ▼                            ▼                             ▼
┌───────────────┐          ┌──────────────────┐          ┌─────────────────┐
│ E1 Core Agent │◄─────────│ E3 MCP Integration│          │ E9 Human Approval│
│ Platform      │  tools   │ Layer             │          │ System          │
└───────┬───────┘          └────────┬──────────┘          └────────┬────────┘
        │ runtime                    │ tools                        │ gates
        ▼                            │                              │
┌───────────────┐                   │                              │
│ E2 Workflow   │◄──────────────────┴──────── orchestrates ────────┘
│ Engine        │
└───────┬───────┘
        │ orchestrates agent steps
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Agent pipeline (each depends on E1+E2; coding/deploy on E3):    │
│  E4 Planning → E5 Coding → E7 Testing → E6 Review → E8 Deploy     │
└───────────────────────────────────────────────────────────────┘
        │ all emit telemetry
        ▼
┌───────────────┐
│ E10 Monitoring│  (depends on E1,E2,E3,E8 for data; cross-cutting)
└───────────────┘
```

**Dependency summary (X → Y means Y depends on X):**
- E1 → E2, E4, E5, E6, E7, E8 (all agents need the runtime)
- E3 → E5, E6, E8 (tools), E4 (Jira read)
- E2 → E4, E5, E6, E7, E8 (orchestration), E9 (pause/resume)
- E9 → E2 (workflow gates)
- E11 → all (tenancy, auth, UI shell)
- E10 → E1, E2, E3, E8 (consumes their telemetry); cross-cutting
- E5 ↔ E7 (test-fix feedback loop), E5 → E6 → E8 (pipeline order)

**Critical path:** E1 → E3 → E2 → E5 → (E7/E6) → E9 → E8.

---

## 6. Development Phases

| Phase | Theme | Epics / Focus | Duration | Exit Criteria |
|---|---|---|---|---|
| **P0 Foundations** | Runtime + tools + tenancy | E1 (1.1–1.3), E3 (3.1, 3.3, 3.6), E11 (11.1) | Weeks 1–4 | An agent can call GitHub tools in a tenant context |
| **P1 Orchestration** | Workflow + first agents | E2 (2.1–2.3, 2.5), E4, E5 (5.1–5.4) | Weeks 4–8 | Plan→Code produces a branch with code |
| **P2 Quality Loop** | Test + review + approval | E7, E6 (6.1, 6.3), E9 (9.1–9.3), E11 (11.2) | Weeks 8–12 | End-to-end run → approved → PR, watchable in UI |
| **P3 Ship & See** | Deploy + observability | E8 (8.1–8.2), E10 (10.1–10.2), E9 (9.4) | Weeks 12–16 | Optional deploy + full traces/cost dashboards |
| **P4 Commercialize** | Billing, multi-stack, alerts | E11 (11.3), E6 (6.2), E2 (2.4), E10 (10.3–10.4), E8 (8.3) | Weeks 16–24 | Paid pilots; rollback + alerting; 2nd stack |

---

## 7. 30-Day Roadmap

**North star for day 30:** A single-tenant internal demo where an agent, orchestrated by the workflow engine, plans and writes a NestJS CRUD module and opens a real GitHub PR — with a trace.

| Week | Deliverables | Owner area |
|---|---|---|
| **Week 1** | Repo/CI/CD scaffolding; service skeletons; Postgres+Redis; Anthropic LLM gateway (1.2 core); agent definition schema + registry (1.1). | Platform |
| **Week 2** | Agent loop (1.3) with tool-use; MCP client (3.1); GitHub MCP read tools + auth (3.3 partial, 3.6 secrets). | Platform/Integrations |
| **Week 3** | Workflow DSL + Temporal integration (2.1, 2.2); canonical pipeline workflow; Planning Agent (4.1, 4.2). | Workflow/Agents |
| **Week 4** | Coding Agent sandbox + multi-file edit + build/lint loop (5.1–5.3); GitHub write/PR tools (3.3 rest); branch+commit (5.4); trace capture (1.5). **Demo: request → PR.** | Agents/Integrations |

**Exit:** Internal demo: free-text request → plan → code → pushed branch → opened PR, with a navigable trace and cost recorded.

---

## 8. 90-Day Roadmap

| Month | Goal | Key Epics/Stories | Milestone |
|---|---|---|---|
| **Month 1 (Days 1–30)** | Plan→Code→PR happy path (single tenant) | E1 (1.1–1.5), E3 (3.1/3.3/3.6), E2 (2.1–2.2), E4, E5 | **M1:** Request → GitHub PR demo |
| **Month 2 (Days 31–60)** | Quality loop + human approval + UI + tenancy | E7, E6 (6.1/6.3), E2 (2.3/2.5), E9 (9.1–9.3), E11 (11.1/11.2), E3 (3.2) | **M2:** End-to-end run with tests, review, **pre-PR approval gate**, watchable in multi-tenant UI |
| **Month 3 (Days 61–90)** | Ship + observe + onboarding (closed beta) | E8 (8.1–8.2), E10 (10.1–10.2), E9 (9.4 audit), E11 (11.4), E3 (3.4 Jira read, 3.5 AWS) | **M3:** Optional deploy to AWS demo env, full traces/cost dashboards, GitHub/Jira/AWS onboarding → **closed beta with 3–5 design partners** |

**Beta entry criteria (Day 90):** ≥70% green-PR rate on exemplar; audit log on all actions; per-run cost visible; one-click GitHub onboarding; approval gate enforced before PR/deploy.

---

## 9. v1 Architecture Diagram

```
                               ┌──────────────────────────────────────────┐
                               │                 CLIENTS                    │
                               │   Web App (React)   •   Slack   •   API    │
                               └───────────────────┬────────────────────────┘
                                                    │ HTTPS / WSS
                                          ┌─────────▼─────────┐
                                          │   API Gateway      │  (authn/z, rate limit)
                                          │   + BFF            │
                                          └─────────┬─────────┘
                  ┌──────────────────────────────────┼───────────────────────────────────┐
                  │                                   │                                    │
        ┌─────────▼─────────┐            ┌────────────▼────────────┐         ┌─────────────▼───────────┐
        │  Tenant/Auth Svc   │            │  Orchestrator Svc        │         │  Approval Svc            │
        │  (orgs, RBAC, SSO) │            │  (workflow control API)  │◄───────►│  (gates, inbox, audit)   │
        └─────────┬─────────┘            └────────────┬────────────┘         └─────────────┬───────────┘
                  │                                   │ start/signal                       │
                  │                       ┌───────────▼────────────┐                       │
                  │                       │  Temporal Cluster       │  (durable workflows)  │
                  │                       └───────────┬────────────┘                       │
                  │                                   │ activities                          │
                  │                       ┌───────────▼────────────┐                        │
                  │                       │  Agent Runtime Svc      │                        │
                  │                       │  (agent loop, memory)   │                        │
                  │                       └──┬─────────┬─────────┬──┘                        │
                  │                          │         │         │                           │
              ┌───▼───┐              ┌────────▼──┐ ┌────▼─────┐ ┌─▼──────────┐                │
              │Postgres│             │LLM Gateway│ │MCP Gateway│ │Vector Store│                │
              │(state) │             │(Anthropic)│ │(tool exec)│ │(pgvector)  │                │
              └───┬────┘             └───────────┘ └────┬─────┘ └────────────┘                │
                  │                                     │ MCP (stdio/HTTP)                     │
                  │                          ┌──────────┼───────────┬───────────┐             │
                  │                    ┌──────▼────┐┌────▼─────┐┌─────▼────┐┌─────▼──────┐      │
                  │                    │GitHub MCP ││Jira MCP  ││AWS MCP   ││Sandbox Svc │      │
                  │                    │Server     ││Server    ││Server    ││(code exec) │      │
                  │                    └───────────┘└──────────┘└──────────┘└────────────┘      │
                  │                                                                              │
        ┌─────────▼──────────────────────────────────────────────────────────────────────────▼──┐
        │  EVENT BUS (Kafka/EventBridge)  •  Secrets Vault (KMS/Secrets Mgr)  •  OTel Collector    │
        └──────────────────────────────────────────────────┬───────────────────────────────────┘
                                                            ▼
                                            ┌───────────────────────────┐
                                            │  Observability (Grafana/    │
                                            │  Prometheus/Tempo) + Billing│
                                            └───────────────────────────┘
```

**Flow (canonical run):** Client → API/BFF → Orchestrator starts a Temporal workflow → each step invokes the Agent Runtime as an activity → Runtime calls LLM Gateway + MCP Gateway (GitHub/Jira/AWS/Sandbox) → approval step signals Approval Svc and waits → on approve, pipeline continues to PR/deploy → all services emit events + OTel telemetry → Observability + Billing consume.

---

## 10. Database Schema

> Postgres (primary, with row-level tenant scoping via `org_id`), Redis (ephemeral), pgvector (embeddings). Temporal owns its own workflow history store.

```sql
-- ============ TENANCY & IDENTITY ============
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',   -- free|pro|enterprise
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  idp_subject   TEXT,                            -- OIDC subject
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                   -- admin|approver|member
  PRIMARY KEY (org_id, user_id)
);

-- ============ INTEGRATIONS & SECRETS ============
CREATE TABLE integrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                   -- github|jira|aws
  status        TEXT NOT NULL DEFAULT 'connected',
  config        JSONB NOT NULL DEFAULT '{}',     -- non-secret config (repo, account id)
  secret_ref    TEXT,                            -- pointer into vault, NEVER the secret
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, type)
);

-- ============ AGENTS (registry) ============
CREATE TABLE agent_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id),  -- NULL = system/global
  role          TEXT NOT NULL,                   -- planning|coding|testing|review|deployment
  version       INT  NOT NULL,
  system_prompt TEXT NOT NULL,
  model_policy  JSONB NOT NULL,                  -- {tier, max_tokens, fallback}
  tools         JSONB NOT NULL,                  -- allowed tool names/scopes
  guardrails    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, version)
);

-- ============ WORKFLOWS & RUNS ============
CREATE TABLE workflow_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id),
  name          TEXT NOT NULL,
  version       INT  NOT NULL,
  spec          JSONB NOT NULL,                  -- DAG/steps DSL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version)
);

CREATE TABLE workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  workflow_def_id UUID NOT NULL REFERENCES workflow_definitions(id),
  temporal_run_id TEXT NOT NULL,                 -- link to Temporal
  requested_by    UUID REFERENCES users(id),
  request_text    TEXT,                          -- the user's NL request
  source          JSONB,                         -- {type: jira, issue_key} | {type: text}
  status          TEXT NOT NULL DEFAULT 'running', -- running|awaiting_approval|succeeded|failed|cancelled
  repo            TEXT,                           -- target repo
  pr_url          TEXT,
  deploy_url      TEXT,
  cost_usd        NUMERIC(12,4) DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX idx_runs_org_status ON workflow_runs(org_id, status);

CREATE TABLE workflow_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                   -- plan|code|test|review|deploy
  agent_role    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|running|succeeded|failed|skipped
  input         JSONB,
  output        JSONB,
  attempt       INT NOT NULL DEFAULT 1,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX idx_steps_run ON workflow_steps(run_id);

-- ============ AGENT EXECUTION TRACE ============
CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id       UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  agent_def_id  UUID REFERENCES agent_definitions(id),
  status        TEXT NOT NULL DEFAULT 'running',
  total_tokens  INT DEFAULT 0,
  cost_usd      NUMERIC(12,4) DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_trace_spans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  kind          TEXT NOT NULL,                   -- model_call|tool_call|observation
  name          TEXT,                            -- tool name / model id
  input         JSONB,                           -- secrets pre-redacted
  output        JSONB,
  tokens_in     INT, tokens_out INT,
  cost_usd      NUMERIC(12,4),
  started_at    TIMESTAMPTZ, finished_at TIMESTAMPTZ
);
CREATE INDEX idx_spans_run_seq ON agent_trace_spans(agent_run_id, seq);

-- ============ MEMORY (vector) ============
CREATE TABLE project_memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  repo          TEXT,
  kind          TEXT,                            -- convention|decision|code_summary
  content       TEXT NOT NULL,
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mem_embedding ON project_memories USING ivfflat (embedding vector_cosine_ops);

-- ============ MCP TOOLS & POLICY ============
CREATE TABLE mcp_servers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,                   -- github|jira|aws|sandbox
  transport     TEXT NOT NULL,                   -- stdio|http
  endpoint      TEXT,
  status        TEXT NOT NULL DEFAULT 'healthy',
  tool_catalog  JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE tool_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  tool_name     TEXT NOT NULL,
  effect        TEXT NOT NULL,                   -- allow|deny|require_approval
  rate_limit    INT,                             -- calls/min
  scope         JSONB
);

-- ============ APPROVALS & AUDIT ============
CREATE TABLE approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  run_id        UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id       UUID REFERENCES workflow_steps(id),
  gate_type     TEXT NOT NULL,                   -- pre_pr|pre_deploy|tool
  context       JSONB,                           -- diff summary, plan, etc.
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|changes_requested|expired
  decided_by    UUID REFERENCES users(id),
  decision_note TEXT,
  sla_due_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);
CREATE INDEX idx_approvals_org_status ON approval_requests(org_id, status);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  org_id        UUID NOT NULL,
  actor_type    TEXT NOT NULL,                   -- user|agent|system
  actor_id      TEXT,
  action        TEXT NOT NULL,                   -- tool.call|pr.create|deploy|approval.decide
  target        TEXT,
  payload       JSONB,
  prev_hash     TEXT,                            -- hash chain for tamper-evidence
  hash          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_time ON audit_log(org_id, created_at);

-- ============ BILLING / USAGE ============
CREATE TABLE usage_events (
  id            BIGSERIAL PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES organizations(id),
  run_id        UUID REFERENCES workflow_runs(id),
  metric        TEXT NOT NULL,                   -- tokens|agent_run|deploy
  quantity      NUMERIC NOT NULL,
  cost_usd      NUMERIC(12,4),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_org_time ON usage_events(org_id, occurred_at);
```

---

## 11. Microservice Breakdown

| Service | Responsibility | Stores | Sync/Async | Scale profile |
|---|---|---|---|---|
| **API Gateway / BFF** | Edge auth, rate limit, request shaping, WS/SSE fan-out | — | Sync + WS | Stateless, HPA |
| **Tenant/Auth Service** | Orgs, users, memberships, RBAC, SSO/OIDC | Postgres | Sync | Low |
| **Orchestrator Service** | Workflow control API; starts/cancels Temporal workflows; status stream | Postgres | Sync + events | Medium |
| **Workflow Workers (Temporal)** | Execute durable workflows + activities (each agent step) | Temporal store | Async | CPU-bound, scale with run volume |
| **Agent Runtime Service** | Agent loop, memory, structured output, trace emission | Redis, pgvector | Sync (from activities) | LLM-IO bound; scale with concurrency |
| **LLM Gateway** | Provider adapters, model routing, retries, token/cost metering | — (emits usage) | Sync | High IO, scale w/ token volume |
| **MCP Gateway** | MCP client, server registry, tool permission/policy, rate limit | Postgres | Sync | Medium |
| **GitHub MCP Server** | Repo/branch/PR/review tools, GitHub App auth | — | Sync | Medium |
| **Jira MCP Server** | Issue read/write/transition tools | — | Sync | Low |
| **AWS MCP Server** | Deploy/ECR/CDK tools, scoped assume-role | — | Sync | Low |
| **Sandbox Service** | Provision ephemeral isolated workspaces; build/lint/test execution | Ephemeral FS | Sync | Bursty; Fargate/Firecracker pool |
| **Approval Service** | Gates, approval inbox, decisions, SLA/escalation, signals workflow | Postgres | Sync + events | Low |
| **Notification Service** | Slack/email/in-app dispatch | — | Async (events) | Low |
| **Audit Service** | Append-only, hash-chained audit log; query/export | Postgres | Async (events) | Write-heavy |
| **Billing/Usage Service** | Meter usage, Stripe, quotas/overage | Postgres | Async (events) | Low |
| **Observability Collector** | OTel ingestion, dashboards, alerting | Tempo/Prom/Loki | Async | Medium |
| **Web App (React SPA)** | Submit requests, run dashboard, approval inbox, settings | — | — | CDN |

**Cross-cutting:** Event Bus (Kafka/EventBridge), Secrets Vault (Secrets Manager + KMS), Service Mesh/mTLS, shared OTel.

---

## 12. API List

> REST over HTTPS; SSE/WS for live status. All endpoints tenant-scoped via auth; `Authorization: Bearer <token>`.

### Auth & Tenancy
- `POST /v1/auth/login` — initiate OIDC/OAuth.
- `GET  /v1/me` — current user + orgs/roles.
- `POST /v1/orgs` — create org.
- `GET  /v1/orgs/{orgId}/members` · `POST /v1/orgs/{orgId}/members` · `PATCH .../members/{userId}` (role).

### Integrations & Onboarding
- `POST /v1/orgs/{orgId}/integrations/github/install` — start GitHub App install.
- `POST /v1/orgs/{orgId}/integrations/jira/connect` — Jira OAuth.
- `POST /v1/orgs/{orgId}/integrations/aws/connect` — register assume-role.
- `GET  /v1/orgs/{orgId}/integrations` · `POST .../integrations/{id}/test`.

### Agents (registry)
- `GET  /v1/agents` · `POST /v1/agents` · `GET /v1/agents/{id}` · `PUT /v1/agents/{id}` (new version).

### Workflows & Runs
- `GET  /v1/workflows` · `POST /v1/workflows` (definition).
- `POST /v1/runs` — start a run `{ workflowId, request | jiraIssueKey, repo }`.
- `GET  /v1/runs` · `GET /v1/runs/{id}` — status + artifacts (PR/test/deploy).
- `POST /v1/runs/{id}/cancel` · `POST /v1/runs/{id}/retry`.
- `GET  /v1/runs/{id}/steps` · `GET /v1/runs/{id}/trace`.
- `GET  /v1/runs/{id}/stream` — **SSE/WS** live status.

### Approvals
- `GET  /v1/approvals?status=pending` — inbox.
- `GET  /v1/approvals/{id}` — context (diff/plan).
- `POST /v1/approvals/{id}/decision` — `{ decision: approve|reject|changes, note }`.

### MCP & Tools
- `GET  /v1/mcp/servers` · `POST /v1/mcp/servers` · `POST /v1/mcp/servers/{id}/health`.
- `GET  /v1/mcp/tools` — catalog.
- `GET  /v1/orgs/{orgId}/tool-policies` · `PUT .../tool-policies`.

### Observability & Billing
- `GET  /v1/orgs/{orgId}/metrics/runs` — success/latency/cost rollups.
- `GET  /v1/orgs/{orgId}/audit?from=&to=` · `GET .../audit/export`.
- `GET  /v1/orgs/{orgId}/usage` · `GET .../billing/invoices`.

### Internal (service-to-service, not public)
- `POST /internal/agent-runtime/execute` — orchestrator/activity → runtime.
- `POST /internal/llm/complete` — runtime → LLM gateway.
- `POST /internal/mcp/invoke` — runtime → MCP gateway (tool call).
- `POST /internal/approvals/request` · `POST /internal/workflow/signal`.

### Webhooks (inbound)
- `POST /webhooks/github` — PR/check events.
- `POST /webhooks/jira` — issue events.
- `POST /webhooks/stripe` — billing events.

---

## 13. MCP Tool Integration Strategy

**Principles**
1. **Everything an agent can *do* is an MCP tool.** No bespoke per-agent integration code — agents declare which tools they may use; the MCP Gateway brokers all calls.
2. **Governance at the gateway, not the model.** Permission checks, rate limits, approval-gating, and audit happen at the MCP Gateway boundary — the model only ever sees tool schemas and results.
3. **Secrets never enter the prompt.** Credentials are resolved just-in-time at the MCP server boundary from the vault and redacted from traces.
4. **Reusable servers per external system.** One MCP server per system (GitHub, Jira, AWS, Sandbox), each exposing a curated, least-privilege toolset.

**Tool tiers (by risk → governance):**

| Tier | Examples | Governance |
|---|---|---|
| **Read** | `github.read_file`, `jira.get_issue`, `aws.describe` | Auto-allow; rate-limited; audited |
| **Write (reversible)** | `github.create_branch`, `github.commit`, `jira.comment` | Allow by policy; audited; idempotency keys |
| **High-risk (gated)** | `github.merge_pr`, `aws.deploy`, `github.create_pr` | `require_approval` → routes through Approval Service |

**Lifecycle:** register server → health check → sync tool catalog → expose schemas to agent loop → invoke via gateway (policy → secret injection → call → redact → audit) → return observation.

**MVP servers:** GitHub (full), Sandbox (exec), Jira (read), AWS (deploy, gated/optional). **Roadmap:** marketplace of community MCP servers; per-org custom servers; signed/verified server registry.

**Selection rule for the agent:** the LLM Gateway surfaces only the tools permitted for that agent+org (policy-filtered), keeping the tool list small to improve tool-choice accuracy and reduce tokens.

---

## 14. Agent Communication Protocol

Agents **do not call each other directly.** They communicate via the **workflow engine** (orchestrated, durable) using a shared, versioned **message envelope** persisted as `workflow_steps.input/output`. This keeps the system observable, replayable, and free of fragile point-to-point coupling.

**Envelope (JSON):**
```jsonc
{
  "envelope_version": "1.0",
  "run_id": "uuid",
  "step_id": "uuid",
  "from_agent": "planning",
  "to_agent": "coding",
  "intent": "implement_plan",          // verb describing requested action
  "payload": { /* role-specific, schema-validated */ },
  "artifacts": [                          // references, not blobs
    { "type": "plan", "ref": "s3://.../plan.json" },
    { "type": "branch", "ref": "helix/run-123/products" }
  ],
  "context_refs": ["mem://project/conventions", "trace://agent_run/abc"],
  "constraints": { "max_cost_usd": 2.0, "deadline": "..." },
  "status": "ok",                         // ok|needs_clarification|failed
  "created_at": "ISO-8601"
}
```

**Handoff contracts (schemas per edge):**
- `planning → coding`: `ImplementationPlan { tasks[], files[], acceptance_criteria[], stack }`
- `coding → testing`: `CodeChange { branch, commits[], changed_files[] }`
- `testing → coding` (loop): `TestReport { passed, failures[], coverage }` (on fail)
- `coding → review`: `CodeChange` + `TestReport`
- `review → approval/deploy`: `ReviewResult { findings[], gate: pass|block }`
- `deploy → done`: `DeploymentResult { url, version, health }`

**Rules:**
1. **Orchestration over choreography for the main pipeline** — Temporal sequences handoffs; agents are pure activities (input envelope → output envelope).
2. **Schema-validated I/O** — every handoff validates against a versioned JSON schema; invalid output triggers a self-correction step.
3. **Artifacts by reference** — large blobs (diffs, plans) live in object storage; envelopes carry refs to keep state small and traces clean.
4. **Backpressure & clarification** — an agent may return `needs_clarification`, which pauses the workflow and (optionally) opens a human approval/clarification request.
5. **Idempotency** — each handoff carries an idempotency key so retries don't duplicate side effects.

---

## 15. Event-Driven Architecture Design

A central **event bus** (Kafka or AWS EventBridge + SNS/SQS) decouples the synchronous request/orchestration path from cross-cutting consumers (audit, billing, notifications, observability, UI live-updates).

**Topics / event taxonomy:**
```
run.requested            run.started            run.step.started
run.step.completed       run.step.failed        run.awaiting_approval
run.completed            run.failed             run.cancelled

agent.step.started       agent.tool.called      agent.tool.result
agent.model.called       agent.completed

approval.requested       approval.decided       approval.expired
tool.invoked             tool.denied
deploy.started           deploy.succeeded       deploy.rolled_back
usage.metered            cost.recorded
integration.connected    integration.failed
```

**Event envelope:** `{ event_id, type, org_id, run_id?, occurred_at, actor, data, trace_id }` — all events carry `trace_id` for correlation and `org_id` for tenant routing.

**Producers → consumers:**

| Producer | Key events | Consumers |
|---|---|---|
| Orchestrator / Workers | `run.*`, `run.step.*` | UI (SSE), Observability, Audit |
| Agent Runtime | `agent.*` | Observability, Audit, Billing (tokens) |
| MCP Gateway | `tool.invoked/denied` | Audit, Observability |
| Approval Service | `approval.*` | Notification, Audit, Orchestrator (resume) |
| Deployment | `deploy.*` | Notification, Observability, Audit |
| LLM Gateway | `usage.metered`, `cost.recorded` | Billing, Observability |

**Patterns:**
- **Outbox pattern** for reliable event publication from services with DB writes (no dual-write loss).
- **Consumer groups** for independent, replayable consumption (audit must never drop events).
- **SSE/WS bridge:** the BFF subscribes to `run.*` and pushes live status to the UI.
- **Saga compensation** is event-driven: `deploy.failed` → `deploy.rollback` command.
- **Dead-letter queues** per consumer with replay tooling.
- **Idempotent consumers** keyed on `event_id`.

**Why event-driven here:** long-running, human-paused workflows + many cross-cutting concerns (audit/billing/observability/notifications) are a textbook fit — the bus lets these evolve independently and guarantees the audit/billing trails even if a synchronous path fails.

---

## 16. AWS Deployment Architecture

> Region-primary (e.g., `us-east-1`), multi-AZ. Containerized services on **ECS Fargate** (or EKS at scale). IaC via **AWS CDK**.

```
Route 53 ──► CloudFront (Web SPA from S3) 
        └──► ACM TLS ──► Application Load Balancer (WAF attached)
                              │
                    ┌─────────▼──────────────────────────────────┐
                    │   VPC (multi-AZ): public + private subnets   │
                    │                                              │
                    │  Public:  ALB, NAT GW                        │
                    │  Private (app):  ECS Fargate services        │
                    │     • API/BFF        • Orchestrator          │
                    │     • Agent Runtime  • LLM Gateway           │
                    │     • MCP Gateway + MCP servers              │
                    │     • Approval/Notif/Audit/Billing           │
                    │     • Temporal workers                       │
                    │  Private (sandbox):  isolated Fargate tasks   │
                    │     • Sandbox Service (no inbound; egress     │
                    │       allowlist via NAT; tight SG)           │
                    │  Private (data):                             │
                    │     • RDS Postgres (Multi-AZ) + pgvector     │
                    │     • ElastiCache Redis                      │
                    │     • Temporal (self-host on ECS or Cloud)   │
                    └──────────────────────────────────────────────┘
                              │
   Managed/AWS services:      │
   • MSK (Kafka) or EventBridge + SNS/SQS  (event bus)
   • ECR (images)            • S3 (artifacts, plans, diffs, logs)
   • Secrets Manager + KMS   (vault; per-tenant keys)
   • CloudWatch + AMP/AMG (Prometheus/Grafana) + X-Ray/OTel (observability)
   • Cognito (auth) or Auth0 • Bedrock/Anthropic API (LLM via egress)
```

**Key decisions:**
- **Network isolation for sandboxes:** code execution runs in a dedicated subnet/SG with **no inbound**, strict egress allowlist (package registries only), ephemeral tasks destroyed per run. Optionally Firecracker/microVM for stronger isolation.
- **Least privilege:** each service has a scoped IAM task role; AWS MCP server assumes per-tenant deploy roles (cross-account into customer accounts for enterprise).
- **Secrets:** Secrets Manager + KMS; per-org encryption context; never in env at rest beyond references.
- **Scaling:** Fargate service auto-scaling on CPU/queue depth; Temporal workers scale on task-queue backlog; LLM Gateway scales on concurrency.
- **Resilience:** Multi-AZ RDS with automated backups/PITR; DLQs; circuit breakers on provider calls.
- **CI/CD:** GitHub Actions → ECR → CDK deploy → ECS rolling/blue-green; per-PR ephemeral preview optional.
- **Multi-region/enterprise (later):** VPC peering/PrivateLink into customer VPCs; region pinning for data residency.

---

## 17. MVP Cost Estimation

> Rough monthly run-rate for a **closed beta** (3–5 design partners, ~500–1,000 agent-runs/month). USD, on-demand pricing; figures are planning-grade estimates, not quotes.

### A. Infrastructure (AWS) — monthly

| Item | Config | Est. $/mo |
|---|---|---|
| ECS Fargate (app services) | ~10 services, small tasks, partial HA | $400–700 |
| Fargate (sandbox tasks) | bursty, per-run ephemeral | $150–300 |
| RDS Postgres (Multi-AZ) | db.t4g.medium + storage/backups | $200–300 |
| ElastiCache Redis | small node | $50–90 |
| Temporal | self-hosted on ECS (incl. in Fargate) or Temporal Cloud | $0–200 |
| Event bus | EventBridge+SQS (cheap) or small MSK | $20–250 |
| S3 + ECR | artifacts/images | $20–50 |
| CloudFront + ALB + WAF + NAT | edge/network | $120–200 |
| Observability | CloudWatch / AMP+AMG | $100–200 |
| Secrets Manager + KMS | per-secret + keys | $20–40 |
| **Infra subtotal** | | **~$1,100–2,300** |

### B. LLM / Model Costs — the dominant variable

Assumptions per agent-run (plan+code+test+review, with self-correction loops): ~**300K–800K tokens** mixed input/output across steps, model-tiered (Opus for planning/review, Sonnet for coding/iteration, Haiku for cheap classification).

| Volume | Blended $/run (est.) | Monthly LLM est. |
|---|---|---|
| 500 runs | $1.50–4.00 | $750–2,000 |
| 1,000 runs | $1.50–4.00 | $1,500–4,000 |

> **Cost levers:** prompt caching (large savings on repeated system prompts/codebase context), tiered routing (Haiku/Sonnet for cheap steps), iteration budgets/bail-outs, and context trimming. Caching alone can cut input-token cost materially on repetitive agent loops.

### C. Third-Party SaaS — monthly

| Item | Est. $/mo |
|---|---|
| Auth (Auth0/Cognito) | $0–250 |
| Stripe | ~2.9% + 30¢ per txn (pass-through) |
| Error tracking / Sentry | $0–100 |
| Slack/email (notifications) | $0–50 |
| **Subtotal** | **~$50–400** |

### D. Total MVP Run-Rate (beta)

| Scenario | Infra | LLM | SaaS | **Total /mo** |
|---|---|---|---|---|
| **Lean (500 runs, cached, frugal HA)** | ~$1,100 | ~$800 | ~$100 | **~$2,000** |
| **Expected (1,000 runs, moderate)** | ~$1,600 | ~$2,500 | ~$200 | **~$4,300** |
| **Upper (1,000 runs, full HA, MSK)** | ~$2,300 | ~$4,000 | ~$400 | **~$6,700** |

**One-time / non-recurring:** design-partner support, security review (pre-SOC2), and engineering time (the real cost — ~3–5 engineers over the 90-day build).

**Unit-economics note:** at an expected blended **$2–4 LLM cost per run** plus marginal infra, pricing agent-runs at **$8–15** (or bundling into seat + usage tiers) yields healthy gross margin while leaving room for the cost levers above to expand it.

---

*End of plan. This is a v1 planning artifact — estimates and scope should be revalidated against live model pricing, design-partner feedback, and a build spike on the Temporal + sandbox path (the two highest-risk components).*
