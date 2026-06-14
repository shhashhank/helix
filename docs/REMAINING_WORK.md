# What's left

A snapshot of the work remaining on Helix, as of the Agent Executor epic landing.

## Where we are

- **All 11 backlog epics are ✅ done** (HELIX-1 … HELIX-11), **0 open issues** in the original backlog.
- The **Agent Executor** forward-scope epic (HELIX-150) is ✅ done — the worker now runs the real per-role
  agents (planning → coding → review → testing → deployment), config-driven (real Anthropic with
  `ANTHROPIC_API_KEY`, else a scripted offline provider).

**So the whole platform is built — but as _seams with deferred real-world bindings_.** That's deliberate:
CI is offline-first (no cloud creds, no network), so wherever a piece needs live cloud/network access we
shipped the **seam + a local, testable implementation** and left the real binding for later. The build being
"done" therefore does **not** yet mean a fully live end-to-end product. What's left is binding those seams
and building the UI.

The canonical list of seams is [DEFERRED.md](../DEFERRED.md) (#1–#14; #10 has landed). This report groups
them into themes and suggests an order.

## Remaining work, by theme

### A. Make the agents do _real_ work (highest-leverage next step)
The executor runs the agents, but the coding/testing agents currently run **tool-less in a throwaway temp
dir**, so they think and write text but don't yet touch real files.

| Gap | In place now | To make real |
|---|---|---|
| **Sandbox with a real workspace** (DEFERRED #3) | `LocalSandboxProvider` (temp dir) + a temp-dir `WorkspaceProvider` in the worker | repo checkout into the workspace; wire `@helix/sandbox`'s checkout + egress/limits |
| **File-edit + test-run tools** (executor `WorkspaceTools`, currently `{}`) | the `WorkspaceTools` seam; `@helix/coding-agent` has the file tools, `@helix/testing-agent` the runner | implement `toolsFor(role, ws)` over those, bound to the workspace |
| **Real LLM** | `ScriptedLlmProvider` + `providerFromEnv` (real Anthropic when keyed) | already swappable — just set `ANTHROPIC_API_KEY` |

**Outcome:** a request actually produces edited files + run tests in a sandbox. This is the most direct
follow-on to HELIX-150.

### B. Real deployment (DEFERRED #4)
| Gap | In place now | To make real |
|---|---|---|
| Build → ECR push → CDK deploy → live URL | `@helix/deployment-agent` (pure synthesis + a runner-backed command seam); a **stub `DeploymentRunner`** in the worker | implement `DeploymentRunner` over `runBuild`/`runCdkDeploy` against Docker + a real AWS account (needs #2 for secrets) |

### C. Live cloud / network / durability bindings
All have a working in-memory/local/stand-in implementation today; "to land" is the real adapter.

| # | Binding | In place now |
|---|---|---|
| **1** | Live Octokit GitHub client + runnable MCP stdio server | typed client surface + tool catalog |
| **2** | AWS Secrets Manager / KMS adapter | `EncryptedSecretStore` + `LocalKms` (envelope encryption, in-memory repo) |
| **5** | Durable approval-request persistence | in-memory approval store seam |
| **7** | Live Slack / email notification transports | in-app feed real; slack/email recorded |
| **8** | Automatic SLA escalation scheduler (timer) | the escalation sweep exists; the periodic trigger is manual |
| **9** | Durable append-only audit store (DB table) | hash-chained `InMemoryAuditLog` |
| **11** | Live run-analytics data source + metrics exporter | pure `@helix/analytics` aggregators + a `RunAnalyticsSource` seam; the **Runs & Cost** Grafana board awaits the metrics |
| **12** | Real OIDC provider (Auth0 / Cognito, RS256/JWKS) | `StaticKeyOidcVerifier` (HS256 stand-in) + app sessions |
| **14** | GitHub onboarding — live install verification + token mint | connect flow + a `GithubConnectionVerifier` seam (`not_configured` default) |

### D. The frontend (everything user-facing is API-first)
HELIX-11 was built **API-first by design** — complete, tested APIs with **no rendered screens**. No frontend
app exists in `apps/` yet.

| Screen | API that backs it |
|---|---|
| **Approval inbox** (DEFERRED #6) | `GET /api/approvals/inbox`, decisions, escalation |
| **Request submission + run dashboard** (DEFERRED #13) | `POST /api/requests`, `/requests/overview`, `/:id/run`, `/:id/stream`, `/:id/artifacts` |
| **GitHub connect wizard** (DEFERRED #14) | `POST /api/integrations/github/connect` + `/callback`, `GET`, `/test` |

Also deferred under #13: turning a request's free-text prompt into a **planning-driven custom workflow**
(today it runs the standard pipeline) and a **durable request store**.

## Suggested order

1. **Sandbox tools + repo checkout (Theme A)** — turns the agents from "describe" to "do". Biggest jump in
   product realism, and mostly local (testable offline-ish). **Planned:**
   [SANDBOX_TOOLS_PLAN.md](SANDBOX_TOOLS_PLAN.md) (epic HELIX-159 → HELIX-161…165).
2. **Real LLM run-through** — set `ANTHROPIC_API_KEY` and validate a full request end-to-end (see
   [END_TO_END_TESTING.md](END_TO_END_TESTING.md)); tune prompts/specs.
3. **The frontend (Theme D)** — a thin web app over the existing APIs; the fastest path to a demoable product.
4. **Real GitHub + Secrets/KMS (#1, #2, #14)** — so runs act on real repos with real credentials.
5. **Real deployment (#4)** and the remaining durability/transport bindings (#5, #7, #8, #9, #11) as the
   product hardens toward production.

Each is best run as its own **forward-scope epic** (the way HELIX-150 was added) — not original-backlog work.

## Pointers
- [DEFERRED.md](../DEFERRED.md) — the authoritative seam list with per-entry "to land" notes.
- [AGENT_EXECUTOR_PLAN.md](AGENT_EXECUTOR_PLAN.md) — how the executor was sliced (a template for the next epic).
- [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) — plain-words per-ticket history; [ARCHITECTURE.md](ARCHITECTURE.md) — the map.
- [END_TO_END_TESTING.md](END_TO_END_TESTING.md) — how to run everything that exists today, end to end.
