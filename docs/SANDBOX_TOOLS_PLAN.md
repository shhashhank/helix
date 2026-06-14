# Plan: Sandbox tools + repo checkout

> **Status:** planned (forward scope — after the Agent Executor epic, HELIX-150).
> **Jira:** Epic [HELIX-159] → Task [HELIX-160] → sub-tasks HELIX-161…HELIX-165.

## Goal

Make the coding/testing agents actually **write files and run tests** in a real workspace, instead of
running tool-less in an empty temp dir. This is the "describe → do" jump — the biggest single increase in
product realism after wiring the executor. See [REMAINING_WORK.md](REMAINING_WORK.md) Theme A.

## What already exists (so this is mostly wiring)

The building blocks are built, tested, and offline-capable — the epic *connects* them:

- **`@helix/sandbox`** — `Sandbox` (workspace `rootDir` + a path-escape `resolve()` guard + `dispose()`),
  `LocalSandboxProvider.provision()`, `checkoutRepo(...)` with a pluggable `RepoFetcher`
  (`InMemoryRepoFetcher` for offline tests; real git later), and `CommandRunner.run(cmd)` with policy/limits.
- **`@helix/coding-agent`** — `FILE_EDIT_TOOLS` (tool schemas) + `createFileEditToolHandler(sandbox)`
  (read/write/patch bound to a sandbox) — exactly the agent tools we need; plus `applyScaffold(...)`
  (scaffold a new project) and `diffSnapshots` (capture changes → the PR artifact).
- **`@helix/testing-agent`** — `runTests(...)`, `generateTests(...)`, `buildTestReport(...)`.

These plug into the two seams already built in HELIX-156 — `WorkspaceProvider` and `WorkspaceTools`.

## Architecture

A **worker-side, sandbox-backed pair** that fills those seams:

```
SandboxWorkspaceProvider  (implements executor's WorkspaceProvider)
  provision(step, runId) → reuse-or-create a @helix/sandbox Sandbox for this run,
                           populate it (scaffold or checkout), return { id, dir }
  registry:  runId → Sandbox

SandboxWorkspaceTools     (implements executor's WorkspaceTools)
  toolsFor('coding',  ws) → file-edit tools bound to the run's Sandbox
  toolsFor('testing', ws) → a run-command / run-tests tool bound to the Sandbox
  (looks the Sandbox up from the shared registry by ws.id)
```

The executor's `Workspace` seam stays the minimal `{ id, dir }`; the worker-side pair bridges it to the
richer `Sandbox` via a shared registry. **No changes to the executor's role logic** — the seams are already
the right shape.

## The one real design decision: workspace must be **per-run**, not per-step

Today `workspaceRoleExecutor` provisions a fresh workspace *per step* and disposes it after. But the
**testing** step needs the files the **coding** step wrote — so the workspace must be **shared across a run's
steps**. Two changes:

1. **Thread the run id** into the executor. Each step runs as a Temporal *activity*; the activity reads
   `Context.current().info.workflowExecution.workflowId` and passes it through (the worker's `runStep` adds it
   to the executor context). The provider keys its registry by that run id → provision-once, reuse.
2. **Move disposal to run-end** (not per-step), with an idle-TTL cleanup as a safety net.

**Trade-off:** this works cleanly for a **single-worker dev setup** (all steps in one process). True
multi-worker durability (steps on different machines) would instead carry the changes as a **diff in the run
context** and re-apply per step (`diffSnapshots` already exists). Noted as a later evolution — **not built
now**.

## Offline-testability (why Theme A is tractable)

`LocalSandboxProvider` + `InMemoryRepoFetcher` + `LocalCommandRunner` are **all local** — so the whole thing
tests offline: provision a sandbox, have a (scripted) agent call `write_file`, assert the file landed, run a
command, assert output, run the testing tool. The **only** part needing the network is a *real* `git clone`,
so checkout starts from an in-memory/fixture repo and real git stays behind the GitHub binding (DEFERRED #1).

## Sub-tasks (Jira, in order)

| Ticket | Sub-task | Size |
|---|---|---|
| HELIX-161 | **Run-scoped workspace + run-id threading** — acquire-per-run (not per-step); thread the Temporal workflowId into the executor context; provider keyed by run id + run-end/idle disposal | M |
| HELIX-162 | **Coding file-edit tools (sandbox-bound)** — `toolsFor('coding')` over `createFileEditToolHandler` + `FILE_EDIT_TOOLS` | S |
| HELIX-163 | **Testing command + test-run tools** — `toolsFor('testing')` over `CommandRunner` + `runTests`; parsed results → the test artifact | M |
| HELIX-164 | **Populate the workspace** — `applyScaffold` (build-new) or `checkoutRepo` (InMemory fetcher; real git deferred); capture a diff for the PR artifact | M |
| HELIX-165 | **Worker wiring** — swap the worker's empty tools + temp-dir provider for the sandbox provider + tools; verify a full run writes files + runs tests (scripted offline, real with a key) | M |

Steps 162–163 are pure plumbing of existing pieces; **161** is the only structural change; **164** has the
only genuinely new logic; **165** flips it on.

## Open decisions (settle per sub-task)

- **New project vs. existing repo:** scaffold-from-prompt vs. checkout-a-target — support both via a
  `repo`/`scaffold` hint in the step `config`, defaulting to scaffold for the demo.
- **Disposal policy:** run-end signal vs. idle TTL — start with **idle TTL** (no workflow change).
- **Multi-worker durability:** single-worker registry now; diff-replay later (flagged, not built).

## What stays deferred

Real **`git clone`** of a GitHub repo (DEFERRED #1) and real **deployment** (DEFERRED #4). This epic makes
the **coding and testing** real (local files + local test runs); the GitHub/AWS bindings remain separate.
