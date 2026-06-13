# Plan: Wire the real Agent Executor

> **Status:** planned (forward scope — the MVP backlog HELIX-1…HELIX-149 is complete).
> **Jira:** Epic [HELIX-150] → Task [HELIX-151] → sub-tasks HELIX-152…HELIX-158.

## Goal

Replace the worker's **stub** step executor with one that actually runs the per-role
agents, so a run does real **planning → coding → review → testing → deployment**
instead of `sleep + "step output"`. This is the single biggest gap between
"backlog complete" and a true end-to-end demo (and it's what makes HELIX-147's
artifact views show real PRs / tests / deploy URLs).

## The seam it slots into (already clean)

- The worker is built `createWorkflowWorker({ …, execute })`, where
  `execute: (step, ctx) => Promise<StepRunResult>`. Today that's the stub
  ([libs/workflow/src/dev-worker.ts](../libs/workflow/src/dev-worker.ts)). **We only
  need to supply a real `execute`** — no workflow-engine changes.
- The agent loop is `runAgent({ provider, agent, executors, input, context, guardrails, onEvent })
  → AgentRunResult` ([libs/agent/src/lib/agent-loop.ts](../libs/agent/src/lib/agent-loop.ts)).
  Every role builds on it.
- **The LLM is the key seam:** `LlmProvider { complete(request) }`
  ([libs/llm](../libs/llm)). Real = `AnthropicProvider` (needs a key) → wrap with
  `MeteredProvider` + `ResilientProvider`. Fake = any object returning canned
  completions. **This is what makes the whole thing testable offline.**
- Roles also need an **AgentSpec** (prompt/model/outputSchema — the shape the
  registry's `AgentDefinition` already stores), role **tools** (`ToolExecutor` map —
  GitHub MCP, file-edit), and for coding/testing a **sandbox**
  ([@helix/sandbox](../libs/sandbox)).

## Architecture

A new lib **`@helix/executor`** — the "runtime" binding workflow steps to agents.
Keeps `libs/workflow` a pure engine; the worker is a Node process, so pulling the
heavier agent/MCP deps there is fine.

```
StepExecutor = (step, ctx) => Promise<StepRunResult>      // one per role
RoleDispatchExecutor: Record<agentRole, StepExecutor>      // dispatch; unknown role → failure
  └ each role executor:
      1. resolve AgentSpec for the role          (AgentSpecResolver seam)
      2. build input from step.config + ctx.results (prior steps)
      3. runAgent({ provider, agent, executors: <role tools>, input })
      4. map AgentRunResult → StepRunResult       (status from stopReason/breach, output = validated)
```

Everything is **injected** (`provider`, `AgentSpecResolver`, sandbox provider, tool
factories), so the executor is constructed once in the worker from config and is
fully unit-testable with fakes.

## Fake-vs-real strategy (what CI can do vs. what needs keys)

| Dependency | Offline CI / tests | Local / real run |
|---|---|---|
| **LLM** | scripted `LlmProvider` (canned completions) | `AnthropicProvider` + key (Metered+Resilient) |
| **AgentSpec** | built-in per-role default specs | registry-backed resolver (HTTP) — later |
| **Sandbox** | `LocalSandboxProvider` (temp dir) | same, or microVM (deferred) |
| **GitHub tools** | fake tool executors | real GitHub MCP (deferred, DEFERRED.md #1) |

The executor logic ships **fully tested in CI with fakes**; you run the *real*
pipeline locally by setting `ANTHROPIC_API_KEY` — no new offline-CI violations.

## Sub-tasks (Jira, in order)

| Ticket | Sub-task | Size |
|---|---|---|
| HELIX-152 | `@helix/executor` scaffold + `StepExecutor` dispatch seam (stub re-expressed as a registered executor) | S |
| HELIX-153 | `AgentSpecResolver` + default per-role specs (registry-backed resolver deferred) | S |
| HELIX-154 | Generic `runAgent`-backed role executor — input from step+context, result mapping, step-to-step context flow | M |
| HELIX-155 | Planning + Review role executors (LLM-only) | M |
| HELIX-156 | Coding + Testing role executors (sandbox + file/test tools) | M |
| HELIX-157 | Deployment role executor (build/deploy seam) | M |
| HELIX-158 | Worker wiring — config-driven dispatcher (fake LLM default; real when `ANTHROPIC_API_KEY` set) | M |

**HELIX-152–154** alone already give a tested real-executor *shape* running on a
scripted LLM (a meaningful E2E with fakes); HELIX-155–158 light up real agents.

## Open decisions (revisit per sub-task)

- **Registry access from the worker:** default to built-in per-role specs now
  (HELIX-153), add an HTTP registry-backed `AgentSpecResolver` later — keeps the
  worker decoupled.
- **Live keys:** the real LLM path needs `ANTHROPIC_API_KEY`, used only as an inline
  env var, never committed, rotated after. CI never needs it.

## What stays deferred even after this

This epic makes the pipeline *real with fakes* and *real-with-keys locally*. Truly
live external calls (hosted LLM at scale, real GitHub writes, AWS deploy) remain the
[DEFERRED.md](../DEFERRED.md) bindings — this just wires the agents in **behind**
those seams.
