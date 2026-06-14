# Running Helix end-to-end — quickstart

The fast path to running the **whole product** locally and driving it through the UI:
**sign in → submit a build request → watch the agents run it live → approve the gate → connect GitHub.**

> Want the full reference (curl flow, RBAC checks, tenant isolation, observability, the automated suites)?
> See [END_TO_END_TESTING.md](END_TO_END_TESTING.md). This page is the minimal "just run it" version.

## What you'll see (real vs. stubbed)

The pipeline genuinely runs — the orchestrator starts a **durable Temporal workflow** and the **worker**
executes each step through the real agent executor. What's real depends on whether you set an API key:

| | Without `ANTHROPIC_API_KEY` | With `ANTHROPIC_API_KEY` |
|---|---|---|
| Pipeline runs (plan→code→review→test→deploy) | ✅ (scripted, canned text) | ✅ (the agents actually reason) |
| Agents **write files + run tests** in a sandbox | ❌ (tools unused) | ✅ |

Optional / still stubbed (don't block the demo): real **GitHub push** + **git clone** (needs a real GitHub App;
offline scaffolds a starter project), **AWS deploy** (returns a placeholder URL), real **OIDC** (a dev sign-in
stands in).

---

## 0. Prerequisites

- **Node 22**, **pnpm**, **Docker** (running), and the **Temporal CLI** (`brew install temporal`).

```bash
pnpm install
```

## 1. Start infrastructure

```bash
# Postgres (the registry DB)
docker compose up -d postgres

# Temporal dev server — gRPC :7233, Web UI http://localhost:8233
# (runs DON'T progress without this)
temporal server start-dev
```

Apply the registry migrations once:

```bash
export REGISTRY_DATABASE_URL="postgresql://helix:helix_dev@localhost:5433/helix_registry?schema=public"
pnpm exec prisma migrate deploy --schema apps/registry/prisma/schema.prisma
```

## 2. Start the services (separate terminals)

```bash
# Terminal A — Orchestrator API           http://localhost:3100/api/docs
pnpm dev:orchestrator

# Terminal B — the agent worker  (this is what actually runs the agents)
pnpm dev:worker
#   …or, to have the agents do REAL work (write files + run tests). Never commit the key; rotate after:
#   ANTHROPIC_API_KEY=sk-… pnpm dev:worker

# Terminal C — the web app                http://localhost:4200
pnpm exec nx serve web
```

> The **registry** (`pnpm dev:registry`) is optional — the worker uses built-in default agent specs.
> If the orchestrator runs somewhere other than `:3100`, point the web app at it by setting
> `window.__HELIX_API_BASE__` (browser console or `index.html`).

## 3. Drive it through the UI

Open **http://localhost:4200**:

1. **Sign in** — enter an email (e.g. `dev@helix.local`), an org (`acme`), pick a role (`admin`). (No real
   identity provider is needed locally — this uses a dev-only sign-in endpoint.)
2. **Dashboard** — submit a request (a title + "what to build"). You jump to the **run page** and watch
   plan → code → review → test → deploy light up **live**, with artifacts (PR / tests / deploy URL) appearing
   as steps finish.
3. **Approvals** — act on any human sign-off gates (approve / reject).
4. **Integrations** — the GitHub connect wizard + a live "Test connection".

The **Temporal Web UI** (http://localhost:8233) shows the same run with full history; Terminal B logs each
step (`▶ step "plan"… ✓ step "plan" — success`).

---

## Troubleshooting

- **Run never leaves RUNNING** → the **worker** (Terminal B) isn't up, or **Temporal** isn't running. Both are
  required for steps to execute.
- **Web app can't reach the API / network errors in the console** → make sure the orchestrator is up on
  `:3100`. (Cross-origin calls are allowed — the orchestrator enables CORS.)
- **Sign-in returns 403** → dev sign-in is disabled in production. Don't set `NODE_ENV=production` for the
  orchestrator (or set `AUTH_DEV_LOGIN=true`).
- **Agents finish but write no files** → that's expected without `ANTHROPIC_API_KEY`; the scripted provider
  completes on canned text. Set the key on the worker for real file edits + test runs.
- **GitHub "Test connection" says `not_configured`** → no GitHub App is wired (expected locally); the connect
  flow still records the installation.

## Verify the automated suites (offline, no services needed)

```bash
pnpm exec nx test web                                     # the React app
pnpm exec jest --config libs/workflow/jest.config.ts      # durable runs (in-memory Temporal)
pnpm exec jest --config libs/executor/jest.config.ts      # the agent executor
# CI runs typecheck + build + test across every lib/app on each PR.
```
