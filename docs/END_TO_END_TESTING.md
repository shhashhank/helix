# End-to-end testing guide

How to stand up **everything Helix has today** and drive a request all the way through — sign in → submit a
request → watch the agents run it (plan → code → review → test → deploy) → see status, artifacts, and the
trace in Grafana. Plus the registry, RBAC, GitHub onboarding, and the automated suites.

> **Set expectations first — what's real vs. stubbed today.** The pipeline genuinely runs: the orchestrator
> starts a durable Temporal workflow and the worker executes each step through the **real agent executor**.
> What's deferred (so it all runs offline) — see [REMAINING_WORK.md](REMAINING_WORK.md):
> - **LLM:** with no `ANTHROPIC_API_KEY` the agents use a **scripted** provider (they finish with canned
>   text and don't call tools). Set the key for real model calls.
> - **Coding/testing agents** now run with **real sandbox-backed tools** (HELIX-159): each run gets a
>   `@helix/sandbox` workspace, the coding step gets file-edit tools and the testing step gets command/test
>   tools, and a change-set diff is captured. So **with a key** a run genuinely writes files + runs tests;
>   offline (scripted) the tools are simply unused. Real `git clone` of a target repo is still deferred —
>   offline scaffolds a starter project.
> - **Deployment** is **stubbed** (returns a placeholder live URL; real AWS build/deploy deferred).
> - **Auth** uses a built-in HS256 stand-in for a real OIDC provider; **GitHub** connect records an
>   installation but doesn't call GitHub yet.
>
> Everything else — durable runs, SSE status, tenancy, RBAC, the vault, tracing, the APIs — is real.

---

## 0. Prerequisites

- **Node 22**, **pnpm**, **Docker** (running), and the **Temporal CLI**.

```bash
brew install temporal          # macOS; or see temporal.io/cli
pnpm install
cp .env.example .env
```

You'll use several terminals. Commands are run from the repo root.

---

## 1. Infrastructure (Postgres · Temporal · Observability)

```bash
# Postgres (pgvector) for the registry
docker compose up -d postgres

# Temporal dev server — gRPC :7233, Web UI http://localhost:8233
temporal server start-dev

# Observability — OTel Collector → Tempo + Prometheus, browsed in Grafana (:3001)
docker compose -f observability/docker-compose.yml up -d
```

Apply registry migrations + generate the client:

```bash
export REGISTRY_DATABASE_URL="postgresql://helix:helix_dev@localhost:5433/helix_registry?schema=public"
pnpm exec prisma migrate deploy --schema apps/registry/prisma/schema.prisma
pnpm exec prisma generate --schema apps/registry/prisma/schema.prisma
```

---

## 2. Start the services

Three more terminals (the worker is what executes the agents):

```bash
# Terminal A — Agent Registry            http://localhost:3000/api/docs
REGISTRY_DATABASE_URL="postgresql://helix:helix_dev@localhost:5433/helix_registry?schema=public" pnpm dev:registry

# Terminal B — Workflow Orchestrator      http://localhost:3100/api/docs
OTEL_TRACE_EXPORTER=otlp pnpm dev:orchestrator      # OTLP on so runs show up in Grafana

# Terminal C — the agent executor worker
pnpm dev:worker                                     # offline (scripted LLM)
#   …or, for REAL agent runs (never commit the key; rotate after):
#   ANTHROPIC_API_KEY=sk-… pnpm dev:worker
```

The worker logs which provider it picked (`[worker] LLM provider: scripted | anthropic`) and then each step
as it runs.

---

## 3. The product flow (the main event)

### 3a. Sign in → get a session

Locally there's no real IdP, so mint a **stand-in OIDC ID token** with the dev secret and exchange it for a
Helix session (the role `admin` lets us also test RBAC later):

```bash
# Mint a stand-in ID token (uses @helix/auth via the swc loader — no build needed)
ID_TOKEN=$(node -r @swc-node/register -e "const {signJwt}=require('./libs/auth/src'); \
  console.log(signJwt({iss:'https://dev-idp.helix.local/',aud:'helix',sub:'user-1', \
  email:'dev@helix.local',org:'acme',roles:['admin']},'dev-insecure-oidc-secret',{expiresInSeconds:600}))")

# Exchange it for a session
TOKEN=$(curl -s -X POST localhost:3100/api/auth/session -H 'Content-Type: application/json' \
  -d "{\"idToken\":\"$ID_TOKEN\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s localhost:3100/api/auth/me -H "Authorization: Bearer $TOKEN"   # → your principal (userId, org, roles)
```

### 3b. Submit a build request → it starts a run

```bash
REQ=$(curl -s -X POST localhost:3100/api/requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "title": "Todo API", "prompt": "build me a NestJS todo API with CRUD" }')
echo "$REQ" | python3 -m json.tool
ID=$(echo "$REQ" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')          # req-…
TRACE=$(echo "$REQ" | python3 -c 'import sys,json;print(json.load(sys.stdin)["traceId"])')   # for Grafana
```

### 3c. Watch the agents run it

```bash
# Live per-step status over SSE — you'll see plan → code → review → test → deploy settle
curl -N localhost:3100/api/requests/$ID/stream -H "Authorization: Bearer $TOKEN"

# Or poll the run status / the dashboard overview
curl -s localhost:3100/api/requests/$ID/run -H "Authorization: Bearer $TOKEN"        # RUNNING → COMPLETED
curl -s localhost:3100/api/requests/overview -H "Authorization: Bearer $TOKEN"        # your requests + statuses
```

In **Terminal C** the worker prints each step (`▶ step "plan"… ✓ step "plan" — success`). The
**Temporal Web UI** (http://localhost:8233) shows the same run with full history. With the scripted LLM the
steps succeed on canned output; with a real key the agents actually reason.

### 3d. Artifacts

```bash
curl -s localhost:3100/api/requests/$ID/artifacts -H "Authorization: Bearer $TOKEN"
```

Artifacts populate from the agents' step outputs (PR / tests / deploy URL). Today the deploy URL is the
stubbed `https://deploy.stub.local`; PR/tests fill in once the real coding/testing tools land.

### 3e. Tenant isolation + RBAC (quick checks)

```bash
# Admin-only route: 200 for our admin session…
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/api/auth/admin/ping -H "Authorization: Bearer $TOKEN"   # 200
# …mint a 'member' session and it's 403:
MEMBER=$(node -r @swc-node/register -e "const {signJwt}=require('./libs/auth/src');console.log(signJwt({iss:'https://dev-idp.helix.local/',aud:'helix',sub:'u2',org:'acme',roles:['member']},'dev-insecure-oidc-secret',{expiresInSeconds:600}))")
MTOK=$(curl -s -X POST localhost:3100/api/auth/session -H 'Content-Type: application/json' -d "{\"idToken\":\"$MEMBER\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/api/auth/admin/ping -H "Authorization: Bearer $MTOK"     # 403
curl -s localhost:3100/api/requests/$ID -H "Authorization: Bearer $MTOK"     # 200 (same org 'acme')
```

A request id from another org returns **404** (row-level isolation).

### 3f. GitHub onboarding

```bash
curl -s -X POST localhost:3100/api/integrations/github/connect -H "Authorization: Bearer $TOKEN"        # install URL + state
# (use the state from above)
curl -s -X POST localhost:3100/api/integrations/github/callback -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{ "installationId": "12345678", "state": "<state>" }'
curl -s localhost:3100/api/integrations/github -H "Authorization: Bearer $TOKEN"        # connected: true
curl -s -X POST localhost:3100/api/integrations/github/test -H "Authorization: Bearer $TOKEN"   # not_configured (no GitHub App locally)
```

---

## 4. Observability — find the run's trace

Open **Grafana** at http://localhost:3001 (anonymous admin) → **Explore** → **Tempo** datasource →
**Search by Trace ID** → paste the `$TRACE` from step 3b to see the run's spans. The **Helix Telemetry
Pipeline** dashboard (Dashboards → Helix) shows live span throughput; **Helix Runs & Cost** lights up once
the run-analytics metrics exporter lands (deferred). See [LOCAL_TESTING.md](LOCAL_TESTING.md) §3.

---

## 5. The registry (agent definitions)

Separate surface — declarative agent definitions, org-scoped. (The worker uses **built-in** default specs
today; a registry-backed resolver is deferred, so this is independent of the run above.)

```bash
curl -s -X POST localhost:3000/api/agents -H 'Content-Type: application/json' -H 'x-org-id: acme' -d '{
  "schemaVersion":"1.0.0","name":"Planning Agent","role":"planning","version":"1.0.0",
  "systemPrompt":{"template":"plan it"},"modelPolicy":{"tier":"opus"},"tools":[],"guardrails":{}
}'
curl -s localhost:3000/api/agents -H 'x-org-id: acme'            # list (org-scoped)
curl -s localhost:3000/api/agents -H 'x-org-id: other'          # empty — tenant isolation
```

Worth trying: duplicate role → 409; `PUT` bumps the version (history kept); `DELETE` soft-deletes; a row id
from another `x-org-id` → 404 (HELIX-143).

---

## 6. Automated tests (what CI runs)

Everything above is also covered by the suites — these are the source of truth and run offline:

```bash
# Per-lib / per-app (examples; CI runs all of them)
pnpm exec jest --config libs/executor/jest.config.ts     # the agent executor (dispatch, roles, pipeline)
pnpm exec jest --config libs/workflow/jest.config.ts     # durable runs against a real in-memory Temporal
pnpm exec jest --config apps/orchestrator/jest.config.ts # auth, tenancy, requests, dashboard, integrations
pnpm exec jest --config apps/registry/jest.config.ts     # agent defs + policies (incl. testcontainers Postgres)
pnpm exec jest --config libs/auth/jest.config.ts         # JWT, OIDC, sessions, RBAC

# Typecheck a project the way CI does (no nx generator)
pnpm exec tsc --noEmit -p apps/orchestrator/tsconfig.spec.json
```

CI (`.github/workflows/ci.yml`) runs **typecheck + build + test** across every lib/app on each PR.

---

## 7. Teardown

```bash
# Ctrl-C the registry / orchestrator / worker / Temporal terminals, then:
docker compose -f observability/docker-compose.yml down
docker compose down                                   # postgres
```

---

## Troubleshooting

- **Worker says `provider: scripted`** — that's expected without `ANTHROPIC_API_KEY`; runs still complete on
  canned output. Set the key for real agent runs.
- **`pnpm dev:worker` can't connect** — start the Temporal dev server first (`temporal server start-dev`);
  override the address with `TEMPORAL_ADDRESS`.
- **Run never leaves RUNNING** — make sure the **worker** terminal is up (it's what executes steps).
- **401 on `/api/requests`** — the request APIs require a session; include `Authorization: Bearer $TOKEN`.
- **No trace in Grafana** — start the orchestrator with `OTEL_TRACE_EXPORTER=otlp` and the observability
  stack before submitting the run.
- **Migrations fail** — confirm `docker compose up -d postgres` is healthy and `REGISTRY_DATABASE_URL` points
  at `:5433`.
