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

# Terminal B — the worker that actually runs steps (the agent executor)
pnpm dev:worker                          # offline: scripted LLM, agents finish with canned text
ANTHROPIC_API_KEY=sk-… pnpm dev:worker    # real agent runs (planning → coding → review → testing → deploy)
```

> The worker runs each step through the **agent executor** (`@helix/executor`, HELIX-150): the five pipeline
> roles on a dispatcher driven by the real `runAgent`. The LLM is **config-driven** — with
> `ANTHROPIC_API_KEY` set it calls the real model; without one it uses the **scripted** provider, so a run
> still executes end-to-end offline (agents finish with canned text). Unknown roles fall back to the
> simulated executor; a step still "fails" on `config.fail = true`.
>
> Deferred (so it stays runnable offline): real repo checkout + file/test tools in the sandbox, and real
> build/ECR/CDK deployment — the workspace is a throwaway temp dir and deployment is stubbed until those
> bindings land (DEFERRED.md). Tunables: `STEP_DELAY_MS` (default 1500), `TEMPORAL_ADDRESS` (default localhost:7233).

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

### Sign in & sessions (HELIX-142)

The orchestrator exposes OIDC sign-in + app sessions. Locally there's no real IdP, so a
**static HS256 verifier** stands in for Auth0/Cognito (the real RS256/JWKS verifier is a
deferred binding). Mint a stand-in ID token with the dev secrets, exchange it for a Helix
session, then call a protected route:

```bash
# Mint a stand-in OIDC ID token (what a real IdP would return), then exchange it.
ID_TOKEN=$(node -e '
  const { signJwt } = require("./dist/libs/auth"); // or use @helix/auth in-repo
  console.log(signJwt({ iss:"https://dev-idp.helix.local/", aud:"helix",
    sub:"user-1", email:"a@b.com", org:"acme", roles:["member"] },
    "dev-insecure-oidc-secret", { expiresInSeconds: 300 }));')

TOKEN=$(curl -s -X POST localhost:3100/api/auth/session -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"$ID_TOKEN\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -s localhost:3100/api/auth/me -H "Authorization: Bearer $TOKEN"   # → the principal
curl -s localhost:3100/api/auth/me                                      # → 401 (no session)
```

Override the dev secrets in real use with `AUTH_OIDC_SECRET` / `AUTH_OIDC_ISSUER` /
`AUTH_OIDC_AUDIENCE` / `AUTH_SESSION_SECRET`. Org-scoped isolation and role enforcement
ride on the returned principal (HELIX-143 / HELIX-144) — e.g. `GET /api/auth/admin/ping`
is **403** unless the session's roles include `admin`.

### Submit a build request (HELIX-145)

With a session `$TOKEN` from above, submit a request — it starts a workflow run and is
scoped to your org (the rendered form is deferred; this is the API):

```bash
curl -s -X POST localhost:3100/api/requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "title": "Todo app", "prompt": "build me a todo API" }'
# → { "id": "req-…", "workflowId": "run-…", "runId": "…", "traceId": "…", "status": "submitted", … }

curl -s localhost:3100/api/requests -H "Authorization: Bearer $TOKEN"            # list your org's requests
curl -s localhost:3100/api/requests/<id> -H "Authorization: Bearer $TOKEN"        # one (404 across tenants)
```

The prompt is recorded for the (deferred) planning-driven workflow; for now the run uses the
standard pipeline (or pass an explicit `workflow`). No session → **401**.

**Run dashboard (HELIX-146)** — the request-scoped, tenant-safe view of runs (data API; screen deferred):

```bash
curl -s localhost:3100/api/requests/overview -H "Authorization: Bearer $TOKEN"      # your requests + each run's status
curl -s localhost:3100/api/requests/<id>/run -H "Authorization: Bearer $TOKEN"       # one request's run status (+ trace id)
curl -N localhost:3100/api/requests/<id>/stream -H "Authorization: Bearer $TOKEN"    # live per-step status (SSE)
curl -s localhost:3100/api/requests/<id>/artifacts -H "Authorization: Bearer $TOKEN" # PR / tests / deploy outputs
```

These go through the request (so they're org-scoped — a cross-tenant id is **404**) rather than
hitting `/api/runs/:id` directly. The `traceId` on each request/run links straight to Grafana/Tempo (§3).
**Artifacts** (HELIX-147) are pulled from the run's step outputs, so they populate as the real coding /
testing / deployment agents produce a PR, test results, and a live URL — with the **stub worker** the run
surfaces none/simulated outputs until the agent executor is wired in.

### Connect GitHub (HELIX-148)

Onboard an org's GitHub via the App install flow — the credential is stored **encrypted in the vault**
(`@helix/secrets`), scoped to your org. The wizard screen is deferred; this is the API it drives:

```bash
# 1. Start — returns the GitHub App install URL (visit it to install the app) + a state.
curl -s -X POST localhost:3100/api/integrations/github/connect -H "Authorization: Bearer $TOKEN"
# → { "installUrl": "https://github.com/apps/helix-dev/installations/new?state=…", "state": "…" }

# 2. After installing, GitHub redirects back with an installation_id — complete the connect:
curl -s -X POST localhost:3100/api/integrations/github/callback -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "installationId": "12345678", "state": "<state from step 1>" }'

curl -s localhost:3100/api/integrations/github -H "Authorization: Bearer $TOKEN"           # status: connected?
curl -s -X POST localhost:3100/api/integrations/github/test -H "Authorization: Bearer $TOKEN"  # health-check (HELIX-149)
curl -s -X DELETE localhost:3100/api/integrations/github -H "Authorization: Bearer $TOKEN"  # disconnect
```

The `state` is single-use and tenant-bound (a callback for another org's state is **400**). The **health
check** (`/test`) reports a status: `not_connected` (connect first), `verified` (access confirmed), or
`not_configured` — locally there's no GitHub App, so it honestly returns `not_configured`. Actually minting
a token against the real GitHub API (the `verified` path) is the deferred binding (DEFERRED.md #14).

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

**Dashboards (HELIX-141)** auto-load into a **Helix** folder (Dashboards → Helix):
- **Helix Telemetry Pipeline** — live now: span receive/export throughput from the
  collector's own telemetry (scraped off `:8888`). Drive some traffic with
  `OTEL_TRACE_EXPORTER=otlp` to see it move.
- **Helix Runs & Cost** — success rate, latency (p50/p95), and cost. It queries a fixed
  Prometheus metric contract (`helix_runs_total`, `helix_run_latency_ms_bucket`,
  `helix_run_cost_usd_total`) that lights up once the run-analytics metrics exporter is
  wired (DEFERRED.md #11) — the panels ship ready.

Dashboards live in [../observability/dashboards/](../observability/dashboards) and are
provisioned by [grafana-dashboards.yaml](../observability/grafana-dashboards.yaml).

### Correlate a run to its trace (HELIX-139)

`POST /api/runs` now returns a `traceId` and `traceparent`, and echoes the `traceparent`
as a response header — so you can jump straight from a run to its trace:

```bash
curl -si -X POST localhost:3100/api/runs -H 'Content-Type: application/json' -d '{ "workflow": {
  "name": "demo", "steps": [{ "id": "plan", "agentRole": "planning" }], "edges": [] } }'
# → response header  traceparent: 00-<traceId>-<spanId>-01
# → body            { "workflowId": "run-…", "runId": "…", "traceId": "<traceId>", "traceparent": "…" }
```

Paste that `traceId` into Grafana → Explore → Tempo (**Search by Trace ID**) to see the run's
trace. The same id is durably attached to the Temporal run (as a memo) and comes back on
`GET /api/runs/<workflowId>`, so a run id always maps back to its trace. Send your own
`traceparent` request header to make the run **join an upstream trace** (the orchestrator
continues that trace id rather than minting a new one).

---

## 4. What's only proven by tests (not yet a manual flow)

Real durability, crash-recovery, human approvals, retries, the agent loop, and embeddings
run green in the suites (the workflow tests use a real in-memory Temporal server):

```bash
pnpm exec jest --config libs/workflow/jest.config.ts    # DAG run, recovery, approvals, retries, progress
pnpm exec jest --config libs/agent/jest.config.ts       # agent loop, guardrails, memory, retrieval
pnpm exec jest --config apps/orchestrator/jest.config.ts
```
