# Local manual testing

How to run what's built and try it by hand, like an end user would. There are two
runnable services today — the **Agent Registry** and the **Workflow Orchestrator** —
plus a local **worker** that actually executes runs.

Prereqs: Node 22, pnpm, Docker, and (for the orchestrator) a Temporal dev server.

```bash
pnpm install
```

---

## 1. Agent Registry API

A NestJS service for declarative agent definitions (create / list / get / version /
soft-delete). Backed by Postgres (with the `vector` extension).

```bash
# Start Postgres (pgvector) + apply migrations
docker compose up -d postgres
cp .env.example .env
pnpm exec prisma migrate deploy --schema apps/registry/prisma/schema.prisma
pnpm exec prisma generate --schema apps/registry/prisma/schema.prisma

# Run it (the running app reads the DB URL from its env)
export REGISTRY_DATABASE_URL="postgresql://helix:helix_dev@localhost:5433/helix_registry?schema=public"
pnpm dev:registry
```

Open **http://localhost:3000/api/docs** (Swagger) and try the `/api/agents` endpoints. With curl:

```bash
curl -s -X POST localhost:3000/api/agents -H 'Content-Type: application/json' -d '{
  "schemaVersion": "1.0.0", "name": "Planning Agent", "role": "planning",
  "version": "1.0.0", "systemPrompt": { "template": "plan it" },
  "modelPolicy": { "tier": "opus" }, "tools": [], "guardrails": {}
}'
curl -s localhost:3000/api/agents            # list
curl -s localhost:3000/api/agents/<id>       # get one
# PUT /api/agents/<id> with a changed body → new version (old kept)
# DELETE /api/agents/<id> → soft delete
```

Worth checking: duplicate role → 409; update bumps the version & preserves history;
soft-deleted rows disappear from list/get; the optional `x-org-id` header scopes to a tenant.

---

## 2. Workflow Orchestrator API + worker (watch a run end-to-end)

The orchestrator starts/inspects/cancels/retries runs and streams live status; the
worker executes the steps. You need a **Temporal dev server**:

```bash
# Temporal (macOS): install the CLI, then run the in-memory dev server
brew install temporal
temporal server start-dev          # gRPC :7233, Web UI http://localhost:8233
```

In two more terminals:

```bash
# Terminal A — the run API
pnpm dev:orchestrator              # http://localhost:3100/api/docs

# Terminal B — the worker that actually runs steps (stub executor for now)
pnpm dev:worker
```

> The worker uses a **stub** step executor that just simulates work (logs, waits,
> succeeds) — real per-role agent execution arrives with the agent epics (HELIX-4..8).
> Tunables: `STEP_DELAY_MS` (default 1500), `TEMPORAL_ADDRESS` (default localhost:7233).

### Start a run and watch it

```bash
# Start a run
curl -s -X POST localhost:3100/api/runs -H 'Content-Type: application/json' -d '{
  "workflow": { "name": "demo",
    "steps": [
      { "id": "plan",   "agentRole": "planning"    },
      { "id": "code",   "agentRole": "coding"      },
      { "id": "review", "agentRole": "code_review" }
    ],
    "edges": [
      { "from": "plan", "to": "code",   "when": "success" },
      { "from": "code", "to": "review", "when": "success" }
    ] } }'
# → { "workflowId": "run-…", "runId": "…" }

# Watch per-step progress live (Server-Sent Events) — you'll see plan → code → review
curl -N localhost:3100/api/runs/<workflowId>/stream

# Or poll the overall status
curl -s localhost:3100/api/runs/<workflowId>           # RUNNING → COMPLETED
```

Other things to try:
- **Validation:** a malformed workflow (empty name, a cycle, an edge to a missing step) → **400**.
- **Branching/failure:** add `"config": { "fail": true }` to the `code` step → the worker fails it; with a `failure` edge to a `fix` step you can watch the recovery branch run.
- **Cancel / retry:** `POST /api/runs/<id>/cancel`; `POST /api/runs/<id>/retry` (with the workflow body) re-runs a failed run.
- **Temporal Web UI** (http://localhost:8233) shows the same run, its history, and per-activity detail.

---

## 3. Observability stack (traces in Grafana)

See what the services are doing (HELIX-137/138). Start the local backend — OTel Collector,
Tempo, Prometheus, Grafana:

```bash
docker compose -f observability/docker-compose.yml up -d
```

Then run any service with the OTLP exporter switched on:

```bash
OTEL_TRACE_EXPORTER=otlp pnpm exec nx serve registry      # or orchestrator
# console-only alternative (no stack needed): OTEL_TRACE_EXPORTER=console
```

Open **Grafana** at http://localhost:3001 (anonymous admin) → **Explore** → the **Tempo**
datasource → search by `service.name` (`registry` / `orchestrator`) to browse traces;
the **Prometheus** datasource has the collector-side metrics. Tear down with
`docker compose -f observability/docker-compose.yml down`.

---

## 4. What's only proven by tests (not yet a manual flow)

Real durability, crash-recovery, human approvals, retries, the agent loop, and embeddings
run green in the suites (the workflow tests use a real in-memory Temporal server):

```bash
pnpm exec jest --config libs/workflow/jest.config.ts    # DAG run, recovery, approvals, retries, progress
pnpm exec jest --config libs/agent/jest.config.ts       # agent loop, guardrails, memory, retrieval
pnpm exec jest --config apps/orchestrator/jest.config.ts
```
