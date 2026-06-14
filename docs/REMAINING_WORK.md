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

### A. Make the agents do _real_ work — ✅ DONE (Sandbox Tools epic, HELIX-159)
The coding/testing agents now run with **real sandbox-backed tools**: each run gets a `@helix/sandbox`
workspace (run-scoped, scaffolded), the **coding** step gets file-edit tools and the **testing** step gets
command/test tools, with the change set captured for the PR. With `ANTHROPIC_API_KEY` set, a request actually
produces edited files + a real test run in a sandbox.

| Gap | Status |
|---|---|
| **Run-scoped workspace** (steps share one sandbox) | ✅ HELIX-161 |
| **Coding file-edit tools** (sandbox-bound) | ✅ HELIX-162 |
| **Testing command + test-run tools** | ✅ HELIX-163 |
| **Populate the workspace** (scaffold / checkout) + change-set diff | ✅ HELIX-164 |
| **Worker wiring** (swap empty tools + temp dir for the sandbox pair) | ✅ HELIX-165 |
| **Real LLM** | ✅ swappable — set `ANTHROPIC_API_KEY` (`providerFromEnv`) |

**Still deferred (separate bindings, not this theme):** real `git clone` of a GitHub repo (DEFERRED #1; offline
scaffolds a starter project) and real build/deploy (Theme B / DEFERRED #4).

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

### D. The frontend — ✅ DONE (Frontend epic, HELIX-173)
HELIX-11 was built **API-first by design**; the React SPA in `apps/web` now renders the screens over those APIs.

| Screen | Status |
|---|---|
| App scaffold + API client + auth context/guard + shell | ✅ HELIX-175 |
| **Sign-in** (dev-login) | ✅ HELIX-176 |
| **Request submission + live run dashboard** (SSE) | ✅ HELIX-177 |
| **Approval inbox** | ✅ HELIX-178 |
| **GitHub connect wizard** (+ live Test connection) | ✅ HELIX-179 |

**Still deferred (separate):** a real OIDC provider redirect (DEFERRED #12; dev-login stands in locally) and
UX/theming polish.

Also deferred under #13: turning a request's free-text prompt into a **planning-driven custom workflow**
(today it runs the standard pipeline) and a **durable request store**.

## Suggested order

1. ~~**Sandbox tools + repo checkout (Theme A)**~~ — ✅ **DONE** (epic HELIX-159 → HELIX-161…165;
   [SANDBOX_TOOLS_PLAN.md](SANDBOX_TOOLS_PLAN.md)). The agents now write files + run tests in a real sandbox.
2. **Real LLM run-through** (next) — set `ANTHROPIC_API_KEY` and validate a full request end-to-end (see
   [END_TO_END_TESTING.md](END_TO_END_TESTING.md)); tune prompts/specs. Now genuinely produces edited files.
3. ~~**The frontend (Theme D)**~~ — ✅ **DONE** (epic HELIX-173 → HELIX-175…179; React SPA in `apps/web`;
   [FRONTEND_PLAN.md](FRONTEND_PLAN.md)). Sign in → submit → watch the run live → approve → connect GitHub.
4. ~~**Real GitHub + Secrets/KMS (#1, #2, #14)**~~ — ✅ **DONE** (epic HELIX-166 → HELIX-168…172;
   [GITHUB_SECRETS_PLAN.md](GITHUB_SECRETS_PLAN.md)). Live Octokit client, MCP server, onboarding verifier, AWS vault.
5. **Close the run → PR loop (required)** — wire the GitHub client into the worker so a finished run opens a
   **real PR** + surfaces real artifacts. **In progress:** [GITHUB_DELIVERY_PLAN.md](GITHUB_DELIVERY_PLAN.md)
   (epic HELIX-180 → HELIX-182…186). The highest-leverage gap — makes the product's core promise true.
6. **Durable persistence** (request/approval/audit stores → Postgres; #13/#5/#9), **real deployment (#4)**,
   **real OIDC (#12)**, then the remaining transport/ops bindings (#7, #8, #11) as the product hardens.

Each is best run as its own **forward-scope epic** (the way HELIX-150 was added) — not original-backlog work.

## Pointers
- [DEFERRED.md](../DEFERRED.md) — the authoritative seam list with per-entry "to land" notes.
- [AGENT_EXECUTOR_PLAN.md](AGENT_EXECUTOR_PLAN.md) — how the executor was sliced (a template for the next epic).
- [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) — plain-words per-ticket history; [ARCHITECTURE.md](ARCHITECTURE.md) — the map.
- [END_TO_END_TESTING.md](END_TO_END_TESTING.md) — how to run everything that exists today, end to end.
